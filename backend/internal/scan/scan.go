package scan

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"mime/multipart"
	"net/http"
	"net/textproto"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"time"

	"paomoney/internal/config"
	"paomoney/internal/shared/llm"
	"paomoney/internal/shared/storage"

	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5/pgxpool"
)

const (
	scanDocReceipt = "receipt"
	scanDocSlip    = "slip"
	scanDocUnknown = "unknown"
)

// OCR result models
type ReceiptItem struct {
	Name   string  `json:"name"`
	Amount float64 `json:"amount"`
	Note   string  `json:"note"`
}

type ReceiptAdjustment struct {
	Amount float64 `json:"amount"`
	Mode   string  `json:"mode,omitempty"`
}

type ReceiptData struct {
	Merchant *string            `json:"merchant"`
	Date     *string            `json:"date"`
	Items    []ReceiptItem      `json:"items"`
	VAT      *ReceiptAdjustment `json:"vat,omitempty"`
	Discount *ReceiptAdjustment `json:"discount,omitempty"`
}

type ocrDateCandidate struct {
	Value      string
	Year       int
	Month      int
	Day        int
	SourceYear int
	YearDigits int
}

type SlipData struct {
	Bank     *string `json:"bank"`
	Amount   float64 `json:"amount"`
	Date     *string `json:"date"`
	Time     *string `json:"time"`
	Sender   *string `json:"sender"`
	Receiver *string `json:"receiver"`
	RefNo    *string `json:"ref_no"`
}

// -----------------------------------------------------------------------------
// External AI API payloads
// -----------------------------------------------------------------------------
// Typhoon OCR returns nested chat-style choices. Typhoon Instruct and the
// classifier use the chat-completion request/response structs below.
type typhoonOCRResp struct {
	Results []struct {
		Success bool `json:"success"`
		Message struct {
			Choices []struct {
				Message struct {
					Content string `json:"content"`
				} `json:"message"`
			} `json:"choices"`
		} `json:"message"`
		Error string `json:"error"`
	} `json:"results"`
}

// -----------------------------------------------------------------------------
// LLM prompts
// -----------------------------------------------------------------------------
// Keep every OCR/parse/classification prompt together so prompt changes are easy
// to audit without searching through the scan pipeline code.
var ocrDocumentClassifierPrompt = `คุณคือระบบแยกประเภทเอกสารจากข้อความ OCR ของแอปการเงิน
ตอบเป็น JSON เท่านั้น ห้ามมี markdown หรือข้อความอื่น
รูปแบบ:
{
  "type": "receipt|slip|unknown",
  "confidence": 0.0
}

นิยาม:
- receipt = ใบเสร็จ/บิล/ใบกำกับภาษี มีร้านค้า รายการสินค้า/บริการ จำนวน ราคา subtotal/total/VAT/cashier/change
- slip = สลิปโอนเงิน/หลักฐานธุรกรรม มีผู้โอน ผู้รับ บัญชี ธนาคาร PromptPay เลขอ้างอิง รายการโอน วันที่เวลาโอน ยอดโอน
  รวมถึง: G-Wallet, ถุงเงิน, คนละครึ่ง, เป๋าตัง, สลิปดิจิทัลวอลเล็ต
- unknown = ข้อมูลไม่พอ หรือไม่มั่นใจ

กฎสำคัญ (เน้นดูโครงสร้างทั้งเอกสาร ไม่ใช่แค่เจอคำใดคำหนึ่ง):
- การที่ใบเสร็จมีคำว่า "โอน", "ธนาคาร", "ค่าธรรมเนียม", "เลขอ้างอิง" หรือมีช่องทางชำระเป็นการโอน ไม่ได้แปลว่าเป็น slip ห้ามตัดสินจากคำเดียว
- slip ที่แท้จริงต้องมีโครงสร้าง "ผู้โอน → ผู้รับ" ชัดเจน (ชื่อผู้โอน + ชื่อ/บัญชีผู้รับ หรือมีลูกศร ↓) หรือเป็นหน้าผลลัพธ์ "โอนสำเร็จ/ชำระเงินสำเร็จ/ทำรายการสำเร็จ"
- receipt ที่แท้จริงต้องมีรายการสินค้า/บริการพร้อมราคาตั้งแต่ 2 รายการขึ้นไป หรือมีร้านค้า + ยอดรวม/VAT/แคชเชียร์/เลขผู้เสียภาษี
- Ref No, reference, transaction id เพียงอย่างเดียวไม่พอให้เป็น slip เพราะใบเสร็จก็มีได้
- ถ้าเอกสารมีรายการสินค้าหลายรายการพร้อมราคา และไม่มีคู่ผู้โอน/ผู้รับ → receipt แม้จะมีคำว่าโอนหรือธนาคารปนอยู่
- "ทำรายการสำเร็จ" + "รหัสอ้างอิง" + G-Wallet/ถุงเงิน → slip เสมอ แม้จะมี "ค่าสินค้า/บริการ" หรือ "สิทธิคนละครึ่ง"
- ถ้ามีทั้งสองแบบจริงๆ (เช่น สลิปคนละครึ่งที่ลิสต์สินค้า) เลือกเอกสารหลัก: ถ้าเป็นหน้ายืนยันการชำระ/โอน → slip
- ถ้าไม่มั่นใจให้ลด confidence ต่ำกว่า 0.6 แล้วตอบชนิดที่ใกล้เคียงที่สุด
- confidence ต้องอยู่ระหว่าง 0 และ 1`

var receiptParserPrompt = `คุณคือผู้ช่วยดึงข้อมูลจากข้อความ OCR ของใบเสร็จ/บิล
ตอบเป็น JSON เท่านั้น ห้ามมีข้อความหรือ markdown อื่น
รูปแบบ:
{
  "merchant": "ชื่อร้านหรือสถานที่",
  "date": "YYYY-MM-DD",
  "items": [
    {"name": "ชื่อรายการ", "amount": 0.00, "note": ""}
  ],
  "vat": {"amount": 0.00, "mode": "include"},
  "discount": {"amount": 0.00, "mode": "prorate"}
}
กฎทั่วไป:
- ตอบ JSON เท่านั้น ไม่มี markdown หรือ code block
- ถ้าข้อความ OCR ไม่ใช่ใบเสร็จหรือบิล ให้ใส่ merchant=null, date=null, items=[], vat=null, discount=null
- ถ้าข้อความ OCR เป็นสลิปโอนเงิน/หลักฐานธุรกรรมธนาคาร/PromptPay/รายการโอนเงิน ให้ใส่ merchant=null, date=null, items=[], vat=null, discount=null ทันที
- ห้ามแปลงข้อมูลสลิป เช่น ผู้โอน ผู้รับ ธนาคาร เลขบัญชี เลขอ้างอิง Transaction ID หรือยอดโอน ให้เป็นรายการสินค้า
- ใบเสร็จต้องมีบริบทของร้านค้า บิล สินค้า/บริการ ราคา ภาษี ยอดรวม หรือแคชเชียร์ ไม่ใช่แค่เลขอ้างอิงและยอดเงิน
- ถ้าหาไม่เจอให้ใส่ null สำหรับ merchant/date/vat/discount หรือ [] สำหรับ items
- date: แปลงเป็น YYYY-MM-DD เสมอ ถ้าเจอปีสองหลัก เช่น 18/03/69 ให้ขยายเป็น 25YY ก่อน (69 → 2569 พ.ศ.) แล้วลบ 543 ได้ ค.ศ. (2569-543=2026) ห้ามใช้ 24YY หรือ 19YY เด็ดขาด ถ้าปีเป็นสี่หลักและ ≥ 2400 ให้ลบ 543 ถ้าน้อยกว่า 2400 ถือว่าเป็น ค.ศ. แล้ว
- items ต้องเป็นรายการสินค้า/บริการเท่านั้น ไม่รวม subtotal, total, vat, tax, change, cash, discount เป็นสินค้า
- amount: ราคาของรายการนั้นเป็น float ไม่มี comma และต้องไม่ติดลบ ไม่ต้องแยกจำนวนสินค้า
- ถ้ามี VAT/ภาษีมูลค่าเพิ่ม ให้ใส่ vat.amount เป็นจำนวนภาษี และ vat.mode="include" ถ้าดูเหมือนรวมในยอดรายการ/ยอดรวมแล้ว หรือ "exclude" ถ้าดูเหมือนต้องบวกเพิ่ม
- ถ้าไม่มี VAT ให้ใส่ vat=null
- ถ้ามีทั้งบรรทัดส่วนลดและข้อความสรุปส่วนลด เช่น "บิลนี้ประหยัด" ให้ใส่ discount.amount เป็นยอดส่วนลดรวมเพียงครั้งเดียว ห้ามบวกซ้ำ
- ถ้ามีส่วนลดรวมทั้งใบหรือส่วนลดรายการ ให้ใส่ discount.amount เป็นยอดส่วนลดรวมแบบบวก และ discount.mode="prorate"
- ห้ามสร้าง item ที่เป็นส่วนลดติดลบ
- note: ปกติใส่ "" แต่ถ้ารายการมีข้อมูลสำคัญ เช่น ส่วนลดเฉพาะรายการ หรือ OCR อ่านไม่ชัด ให้ใส่รายละเอียดสั้นๆ`

var slipParserPrompt = `คุณคือผู้ช่วยดึงข้อมูลจากข้อความ OCR ของสลิปธนาคารไทยและสลิปดิจิทัลวอลเล็ต
ตอบเป็น JSON เท่านั้น ห้ามมีข้อความหรือ markdown อื่น
รูปแบบ:
{
  "bank": "ชื่อธนาคารหรือแพลตฟอร์ม เช่น กสิกรไทย ไทยพาณิชย์ กรุงเทพ กรุงไทย ออมสิน กรุงศรี ทีทีบี ธ.ก.ส. UOB G-Wallet เป๋าตัง ไทยช่วยไทย",
  "amount": 0.00,
  "date": "YYYY-MM-DD",
  "time": "HH:MM",
  "sender": "ชื่อผู้โอน (เฉพาะชื่อ ไม่รวมเลขบัญชี)",
  "receiver": "ชื่อร้าน/ชื่อบัญชีปลายทาง/ชื่อผู้รับ (เฉพาะชื่อ ไม่รวมเลขบัญชี)",
  "ref_no": "รหัสอ้างอิง หรือเลขที่รายการ"
}
กฎ:
- ตอบ JSON เท่านั้น ไม่มี markdown
- ถ้าหาไม่เจอให้ใส่ null
- date: แปลงเป็น YYYY-MM-DD (วันที่ พ.ศ. ให้ลบ 543 ก่อน)
- amount: เป็น float ไม่มี comma เช่น 1500.00
  - ถ้ามีหลายยอดเงิน ให้เลือก "จำนวนเงินที่ชำระ" หรือ "ยอดสุทธิ" หรือ "ยอดโอน" (ยอดที่ผู้ใช้จ่ายจริง ไม่ใช่ราคาก่อนส่วนลด)
  - สำหรับ G-Wallet / คนละครึ่ง / ไทยช่วยไทย : "ค่าสินค้า/บริการ" คือราคาเต็ม ให้ใช้ "จำนวนเงินที่ชำระ" แทน
- receiver: ถ้าส่วนผู้รับมีทั้งชื่อร้านและชื่อบุคคล ให้เลือกชื่อร้านหรือชื่อบัญชีปลายทางก่อนชื่อบุคคล
- ถ้าพบบรรทัดหลังสัญลักษณ์ ↓ หรือหลังคำว่า ผู้รับ/ไปยังบัญชี หลายบรรทัด ให้เลือกบรรทัดแรกที่ไม่ใช่เลขบัญชี ไม่ใช่เลขอ้างอิง และไม่ใช่ชื่อธนาคารเป็น receiver
- ref_no: ให้เลือก Transaction reference หรือ รหัสอ้างอิง หรือ เลขที่รายการที่ยาวที่สุด`

// -----------------------------------------------------------------------------
// Receipt validation and date normalization
// -----------------------------------------------------------------------------
// A valid receipt must have a date and at least one positive line item. The date
// helpers normalize Thai Buddhist years and two-digit OCR years into YYYY-MM-DD.
func looksInvalidReceipt(parsed *ReceiptData) bool {
	if parsed == nil || len(parsed.Items) == 0 {
		return true
	}
	if parsed.Date == nil || strings.TrimSpace(*parsed.Date) == "" {
		return true
	}
	positiveItems := 0
	for _, item := range parsed.Items {
		if strings.TrimSpace(item.Name) != "" && item.Amount > 0 {
			positiveItems++
		}
	}
	return positiveItems == 0
}

var (
	ocrISODateRe      = regexp.MustCompile(`\b(\d{4})-(\d{1,2})-(\d{1,2})\b`)
	ocrNumericDateRe  = regexp.MustCompile(`\b(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})\b`)
	ocrThaiTextDateRe = regexp.MustCompile(`(\d{1,2})\s*([\p{L}.]+)\s*(\d{2,4})`)
)

var ocrThaiMonths = map[string]int{
	"มค": 1, "มกราคม": 1,
	"กพ": 2, "กุมภาพันธ์": 2,
	"มีค": 3, "มีนาคม": 3,
	"เมย": 4, "เมษายน": 4,
	"พค": 5, "พฤษภาคม": 5,
	"มิย": 6, "มิถุนายน": 6,
	"กค": 7, "กรกฎาคม": 7,
	"สค": 8, "สิงหาคม": 8,
	"กย": 9, "กันยายน": 9,
	"ตค": 10, "ตุลาคม": 10,
	"พย": 11, "พฤศจิกายน": 11,
	"ธค": 12, "ธันวาคม": 12,
	"jan": 1, "january": 1,
	"feb": 2, "february": 2,
	"mar": 3, "march": 3,
	"apr": 4, "april": 4,
	"may": 5,
	"jun": 6, "june": 6,
	"jul": 7, "july": 7,
	"aug": 8, "august": 8,
	"sep": 9, "sept": 9, "september": 9,
	"oct": 10, "october": 10,
	"nov": 11, "november": 11,
	"dec": 12, "december": 12,
}

func normalizeReceiptOCRDate(data *ReceiptData, ocrText string) {
	if data == nil || data.Date == nil {
		return
	}
	if normalized := normalizeFinancialOCRDate(*data.Date, ocrText); normalized != "" {
		data.Date = &normalized
	}
}

func normalizeSlipOCRDate(data *SlipData, ocrText string) {
	if data == nil || data.Date == nil {
		return
	}
	if normalized := normalizeFinancialOCRDate(*data.Date, ocrText); normalized != "" {
		data.Date = &normalized
	}
}

func normalizeFinancialOCRDate(value, ocrText string) string {
	raw := strings.TrimSpace(value)
	if raw == "" {
		return raw
	}

	if candidate, ok := firstOCRDateCandidate(raw); ok {
		if candidate.YearDigits == 4 && (candidate.SourceYear >= 1957 && candidate.SourceYear <= 1999 || candidate.SourceYear >= 2057 && candidate.SourceYear <= 2099) {
			if matched, found := matchingOCRShortYearDate(ocrText, candidate.Day, candidate.Month, candidate.SourceYear%100); found {
				return matched.Value
			}
		}
		return candidate.Value
	}

	if candidate, ok := firstOCRDateCandidate(ocrText); ok {
		return candidate.Value
	}
	return raw
}

func firstOCRDateCandidate(text string) (ocrDateCandidate, bool) {
	if match := ocrISODateRe.FindStringSubmatch(text); len(match) == 4 {
		year, _ := strconv.Atoi(match[1])
		month, _ := strconv.Atoi(match[2])
		day, _ := strconv.Atoi(match[3])
		if candidate, ok := buildOCRDateCandidate(day, month, year, len(match[1])); ok {
			return candidate, true
		}
	}

	if match := ocrNumericDateRe.FindStringSubmatch(text); len(match) == 4 {
		day, _ := strconv.Atoi(match[1])
		month, _ := strconv.Atoi(match[2])
		year, _ := strconv.Atoi(match[3])
		if candidate, ok := buildOCRDateCandidate(day, month, year, len(match[3])); ok {
			return candidate, true
		}
	}

	for _, match := range ocrThaiTextDateRe.FindAllStringSubmatch(text, -1) {
		if len(match) != 4 {
			continue
		}
		monthName := strings.ToLower(strings.ReplaceAll(strings.TrimSpace(match[2]), ".", ""))
		month, ok := ocrThaiMonths[monthName]
		if !ok {
			continue
		}
		day, _ := strconv.Atoi(match[1])
		year, _ := strconv.Atoi(match[3])
		if candidate, ok := buildOCRDateCandidate(day, month, year, len(match[3])); ok {
			return candidate, true
		}
	}

	return ocrDateCandidate{}, false
}

func matchingOCRShortYearDate(text string, day, month, shortYear int) (ocrDateCandidate, bool) {
	candidates := make([]ocrDateCandidate, 0)
	for _, match := range ocrNumericDateRe.FindAllStringSubmatch(text, -1) {
		if len(match) != 4 || len(match[3]) != 2 {
			continue
		}
		d, _ := strconv.Atoi(match[1])
		m, _ := strconv.Atoi(match[2])
		y, _ := strconv.Atoi(match[3])
		if candidate, ok := buildOCRDateCandidate(d, m, y, len(match[3])); ok {
			candidates = append(candidates, candidate)
		}
	}
	for _, match := range ocrThaiTextDateRe.FindAllStringSubmatch(text, -1) {
		if len(match) != 4 || len(match[3]) != 2 {
			continue
		}
		monthName := strings.ToLower(strings.ReplaceAll(strings.TrimSpace(match[2]), ".", ""))
		m, ok := ocrThaiMonths[monthName]
		if !ok {
			continue
		}
		d, _ := strconv.Atoi(match[1])
		y, _ := strconv.Atoi(match[3])
		if candidate, ok := buildOCRDateCandidate(d, m, y, len(match[3])); ok {
			candidates = append(candidates, candidate)
		}
	}

	for _, candidate := range candidates {
		if candidate.Day == day && candidate.Month == month && candidate.SourceYear == shortYear {
			return candidate, true
		}
	}
	return ocrDateCandidate{}, false
}

func buildOCRDateCandidate(day, month, rawYear, yearDigits int) (ocrDateCandidate, bool) {
	year := normalizeOCRYear(rawYear, yearDigits)
	date := time.Date(year, time.Month(month), day, 0, 0, 0, 0, time.UTC)
	if date.Year() != year || int(date.Month()) != month || date.Day() != day {
		return ocrDateCandidate{}, false
	}
	return ocrDateCandidate{
		Value:      date.Format("2006-01-02"),
		Year:       year,
		Month:      month,
		Day:        day,
		SourceYear: rawYear,
		YearDigits: yearDigits,
	}, true
}

func normalizeOCRYear(year, digits int) int {
	if digits <= 2 {
		// 2-digit Thai short year: YY means BE 25YY → CE = 1957+YY
		if year >= 43 {
			return year + 1957
		}
		return year + 2000
	}
	if year >= 2400 {
		// Full BE year (e.g. 2569) → CE
		return year - 543
	}
	// LLM added 1900 to a 2-digit Thai year (e.g. 69 → 1969 instead of 2026)
	// Correct: 1957+YY is the true CE, so 1969 → 2026 (+57)
	if year >= 1957 && year <= 1999 {
		return year + 57
	}
	// LLM used BE 2400s instead of BE 2500s (e.g. 2469-543=1926 instead of 2569-543=2026)
	// Shift forward one century to correct
	if year >= 1857 && year <= 1956 {
		return year + 100
	}
	if year >= 2057 && year <= 2099 {
		return year - 43
	}
	return year
}

// sanitizeReceiptData removes non-product lines that may be parsed as items,
// such as VAT, totals, discounts, cash/change, or summary rows.
func sanitizeReceiptData(data *ReceiptData) {
	if data == nil {
		return
	}

	items := make([]ReceiptItem, 0, len(data.Items))
	discountAmount := 0.0
	vatAmount := 0.0

	for _, item := range data.Items {
		name := strings.TrimSpace(item.Name)
		if name == "" || item.Amount <= 0 {
			continue
		}
		lowerName := strings.ToLower(name)

		if isReceiptDiscountLine(lowerName) {
			discountAmount += item.Amount
			continue
		}
		if isReceiptVATLine(lowerName) {
			vatAmount += item.Amount
			continue
		}
		if isReceiptSummaryLine(lowerName) {
			continue
		}

		item.Name = name
		items = append(items, item)
	}

	data.Items = items
	if discountAmount > 0 {
		if data.Discount == nil {
			data.Discount = &ReceiptAdjustment{Amount: discountAmount, Mode: "prorate"}
		} else {
			data.Discount.Amount = normalizeReceiptDiscountAmount(data.Discount.Amount, discountAmount)
		}
		if strings.TrimSpace(data.Discount.Mode) == "" {
			data.Discount.Mode = "prorate"
		}
	}
	if vatAmount > 0 && data.VAT == nil {
		data.VAT = &ReceiptAdjustment{Amount: vatAmount, Mode: "include"}
	}
}

func isReceiptDiscountLine(name string) bool {
	keywords := []string{
		"discount", "disc", "coupon", "voucher", "promotion", "promo", "rebate", "saving",
		"ส่วนลด", "ลดราคา", "ลด", "คูปอง", "โปรโมชั่น", "โปรโมชัน", "ประหยัด",
	}
	for _, keyword := range keywords {
		if strings.Contains(name, strings.ToLower(keyword)) {
			return true
		}
	}
	return false
}

func normalizeReceiptDiscountAmount(parsedAmount, lineAmount float64) float64 {
	if lineAmount <= 0 {
		return parsedAmount
	}
	if parsedAmount <= 0 {
		return lineAmount
	}

	diff := parsedAmount - lineAmount
	if diff < 0 {
		diff = -diff
	}
	if diff <= 1 {
		if parsedAmount < lineAmount {
			return parsedAmount
		}
		return lineAmount
	}

	larger := parsedAmount
	smaller := lineAmount
	if lineAmount > parsedAmount {
		larger = lineAmount
		smaller = parsedAmount
	}
	if smaller > 0 && larger/smaller <= 1.25 {
		return larger
	}
	return smaller
}

func isReceiptVATLine(name string) bool {
	keywords := []string{
		"vat", "tax", "ภาษี", "ภาษีมูลค่าเพิ่ม",
	}
	for _, keyword := range keywords {
		if strings.Contains(name, strings.ToLower(keyword)) {
			return true
		}
	}
	return false
}

func isReceiptSummaryLine(name string) bool {
	keywords := []string{
		"subtotal", "sub total", "total", "grand total", "net total", "balance",
		"cash", "change", "paid", "payment", "rounding", "round",
		"รวม", "รวมทั้งสิ้น", "ยอดรวม", "ยอดสุทธิ", "เงินสด", "เงินทอน", "ชำระ", "ปัดเศษ",
	}
	for _, keyword := range keywords {
		if strings.Contains(name, strings.ToLower(keyword)) {
			return true
		}
	}
	return false
}

func looksLikeSlipInReceiptFlow(text string, parsed *ReceiptData) bool {
	if classifyOCRDocument(text) == ocrDocSlip {
		return true
	}
	if classifyOCRDocument(text) == ocrDocReceipt {
		return false
	}

	t := strings.ToLower(text)
	transferHints := []string{
		"transaction", "transaction id", "reference", "reference no", "ref no", "ref.",
		"promptpay", "transfer", "sender", "receiver", "from account", "to account",
		"account no", "kbank", "scb", "krungthai", "ktb", "bangkok bank", "bbl",
		"kasikorn",
		"เลขที่รายการ", "เลขอ้างอิง", "รหัสอ้างอิง", "พร้อมเพย์", "โอนเงิน",
		"จากบัญชี", "ไปยังบัญชี", "ผู้โอน", "ผู้รับ", "ผู้รับเงิน", "ธนาคาร",
		"g-wallet", "g wallet", "ถุงเงิน", "ทำรายการสำเร็จ", "จำนวนเงินที่ชำระ", "คนละครึ่ง", "ไทยช่วยไทย",
	}

	hints := 0
	for _, hint := range transferHints {
		if strings.Contains(t, strings.ToLower(hint)) {
			hints++
		}
	}
	if hints < 2 {
		return false
	}

	return looksSuspiciousAsReceipt(parsed)
}

func looksSuspiciousAsReceipt(parsed *ReceiptData) bool {
	if parsed == nil {
		return true
	}

	merchant := ""
	if parsed.Merchant != nil {
		merchant = strings.TrimSpace(*parsed.Merchant)
	}
	if merchant == "" && len(parsed.Items) <= 2 {
		return true
	}

	suspiciousNames := 0
	for _, item := range parsed.Items {
		name := strings.ToLower(strings.TrimSpace(item.Name))
		if name == "" {
			continue
		}
		keywords := []string{
			"transfer", "transaction", "reference", "ref", "promptpay", "account", "bank",
			"โอนเงิน", "เลขอ้างอิง", "รหัสอ้างอิง", "พร้อมเพย์", "ผู้โอน", "ผู้รับ", "ธนาคาร",
		}
		for _, keyword := range keywords {
			if strings.Contains(name, strings.ToLower(keyword)) {
				suspiciousNames++
				break
			}
		}
	}

	return suspiciousNames > 0 && suspiciousNames >= (len(parsed.Items)+1)/2
}

type ocrDocType string

const (
	ocrDocUnknown ocrDocType = "unknown"
	ocrDocReceipt ocrDocType = "receipt"
	ocrDocSlip    ocrDocType = "slip"
)

// -----------------------------------------------------------------------------
// Document classification
// -----------------------------------------------------------------------------
// The classifier first checks strong deterministic slip evidence, then scores
// receipt/slip keywords, and finally can fall back to the LLM classifier.
func classifyOCRDocument(text string) ocrDocType {
	strongSlip := hasStrongSlipEvidence(text)
	strongReceipt := hasStrongReceiptEvidence(text)

	// ทั้งคู่ชัด
	if strongSlip && strongReceipt {
		return ocrDocUnknown
	}
	if strongSlip {
		return ocrDocSlip
	}
	if strongReceipt {
		return ocrDocReceipt
	}

	// ไม่มีฝั่งไหนชัดเชิงโครงสร้าง → ให้คะแนนจากคำเฉพาะทาง (ตัดคำกำกวมที่เจอได้ทั้งสองแบบออก)
	t := strings.ToLower(text)
	slipScore := countKeywordHits(t, distinctiveSlipKeywords)
	receiptScore := countKeywordHits(t, distinctiveReceiptKeywords)

	if slipScore >= 2 && slipScore > receiptScore {
		return ocrDocSlip
	}
	if receiptScore >= 2 && receiptScore >= slipScore {
		return ocrDocReceipt
	}
	return ocrDocUnknown
}

// คำเฉพาะทางของแต่ละชนิด — เลี่ยงคำกำกวม (ธนาคาร/โอนเงิน/ค่าธรรมเนียม/จำนวนเงิน) ที่เจอได้ทั้งใบเสร็จและสลิป
var distinctiveSlipKeywords = []string{
	"promptpay", "พร้อมเพย์", "โอนสำเร็จ", "โอนเงินสำเร็จ", "ชำระเงินสำเร็จ", "สลิป",
	"ผู้โอน", "ผู้รับเงิน", "จากบัญชี", "ไปยังบัญชี", "เลขที่รายการ",
	"สแกนตรวจสอบสลิป", "g-wallet", "ถุงเงิน", "รหัสอ้างอิง", "k+",
}

var distinctiveReceiptKeywords = []string{
	"receipt", "tax invoice", "ใบเสร็จ", "ใบกำกับภาษี", "ภาษีมูลค่าเพิ่ม",
	"เงินทอน", "แคชเชียร์", "cashier", "เลขประจำตัวผู้เสียภาษี", "subtotal", "vat",
}

func countKeywordHits(lowerText string, keywords []string) int {
	score := 0
	for _, keyword := range keywords {
		if strings.Contains(lowerText, strings.ToLower(keyword)) {
			score++
		}
	}
	return score
}

// hasStrongSlipEvidence ต้องเจอหลักฐานเชิงโครงสร้าง/วลีสำเร็จ ไม่ใช่แค่คำเดี่ยวที่ใบเสร็จก็มี
func hasStrongSlipEvidence(text string) bool {
	t := strings.ToLower(text)

	// วลี "สำเร็จ" ของการโอน/ชำระ ที่ใบเสร็จทั่วไปไม่มี
	successPhrase := strings.Contains(t, "ชำระเงินสำเร็จ") ||
		strings.Contains(t, "โอนสำเร็จ") ||
		strings.Contains(t, "โอนเงินสำเร็จ") ||
		strings.Contains(t, "ทำรายการสำเร็จ") ||
		strings.Contains(t, "สแกนตรวจสอบสลิป")

	// คอมโบ PromptPay + ปลายทาง (ต้องเจอคู่กัน)
	promptPayCombo := (strings.Contains(t, "promptpay") || strings.Contains(t, "พร้อมเพย์")) &&
		(strings.Contains(t, "ผู้รับ") ||
			strings.Contains(t, "ผู้รับเงิน") ||
			strings.Contains(t, "ไปยังบัญชี") ||
			strings.Contains(t, "เลขที่รายการ"))

	// คอมโบ G-Wallet/ถุงเงิน + รหัสอ้างอิง
	gWalletCombo := (strings.Contains(t, "ทำรายการสำเร็จ") || strings.Contains(t, "g-wallet") || strings.Contains(t, "ถุงเงิน")) &&
		(strings.Contains(t, "รหัสอ้างอิง") || strings.Contains(t, "จำนวนเงินที่ชำระ"))

	return successPhrase || hasSenderReceiverStructure(text) || promptPayCombo || gWalletCombo
}

// hasSenderReceiverStructure = true เฉพาะเมื่อมีทั้งฝั่งผู้โอนและฝั่งผู้รับ (รูปร่างเฉพาะของสลิป)
func hasSenderReceiverStructure(text string) bool {
	t := strings.ToLower(text)
	hasSender := strings.Contains(t, "ผู้โอน") ||
		strings.Contains(t, "จากบัญชี") ||
		strings.Contains(t, "from account") ||
		strings.Contains(t, "from:")
	hasReceiver := strings.Contains(t, "ผู้รับเงิน") ||
		strings.Contains(t, "ผู้รับ") ||
		strings.Contains(t, "ไปยังบัญชี") ||
		strings.Contains(t, "to account") ||
		strings.Contains(text, "↓")
	return hasSender && hasReceiver
}

// hasStrongReceiptEvidence = มีคำเฉพาะใบเสร็จ/ใบกำกับภาษี หรือมีรายการสินค้า+ราคาหลายรายการ
func hasStrongReceiptEvidence(text string) bool {
	t := strings.ToLower(text)
	receiptDocCue := strings.Contains(t, "ใบเสร็จ") ||
		strings.Contains(t, "ใบกำกับภาษี") ||
		strings.Contains(t, "tax invoice") ||
		strings.Contains(t, "receipt") ||
		strings.Contains(t, "เลขประจำตัวผู้เสียภาษี") ||
		strings.Contains(t, "แคชเชียร์") ||
		strings.Contains(t, "cashier") ||
		strings.Contains(t, "เงินทอน")

	return receiptDocCue || countReceiptLineItems(text) >= 2
}

var (
	receiptItemNameRe  = regexp.MustCompile(`\p{L}{2,}`)
	receiptItemPriceRe = regexp.MustCompile(`\d+[.,]\d{2}`)
)

// countReceiptLineItems นับบรรทัดที่ดูเหมือน "ชื่อสินค้า + ราคา(มีทศนิยม)" โดยข้ามบรรทัดสรุป/ยอดรวม
func countReceiptLineItems(text string) int {
	summaryHints := []string{
		"total", "subtotal", "vat", "ภาษี", "รวม", "ยอด", "ทอน", "เงินสด",
		"cash", "change", "ส่วนลด", "discount", "ค่าธรรมเนียม", "fee",
		"ref", "อ้างอิง", "เลขที่รายการ", "balance", "คงเหลือ",
	}
	count := 0
	for _, line := range strings.Split(text, "\n") {
		l := strings.TrimSpace(line)
		if l == "" {
			continue
		}
		low := strings.ToLower(l)
		isSummary := false
		for _, hint := range summaryHints {
			if strings.Contains(low, hint) {
				isSummary = true
				break
			}
		}
		if isSummary {
			continue
		}
		if receiptItemNameRe.MatchString(l) && receiptItemPriceRe.MatchString(l) {
			count++
		}
	}
	return count
}

func hasSlipTransferEvidence(text string, parsed *SlipData) bool {
	if parsed == nil {
		return false
	}

	docType := classifyOCRDocument(text)
	if docType == ocrDocReceipt {
		return false
	}

	hasAmount := parsed.Amount > 0
	hasReceiver := parsed.Receiver != nil && strings.TrimSpace(*parsed.Receiver) != ""
	hasRefNo := parsed.RefNo != nil && strings.TrimSpace(*parsed.RefNo) != ""
	hasDestinationEvidence := hasReceiver || hasSlipDestinationEvidence(text)

	return hasAmount && hasRefNo && hasDestinationEvidence
}

func hasSlipDestinationEvidence(text string) bool {
	lines := strings.Split(text, "\n")
	for i, line := range lines {
		current := strings.TrimSpace(line)
		if current == "" {
			continue
		}
		lower := strings.ToLower(current)
		isDestinationCue := current == "↓" ||
			strings.Contains(lower, "receiver") ||
			strings.Contains(lower, "to account") ||
			strings.Contains(current, "ผู้รับ") ||
			strings.Contains(current, "ผู้รับเงิน") ||
			strings.Contains(current, "ไปยังบัญชี") ||
			strings.Contains(current, "ไปยัง")
		if !isDestinationCue {
			continue
		}
		for _, nextLine := range lines[i+1:] {
			candidate := strings.TrimSpace(nextLine)
			if candidate == "" {
				continue
			}
			candidateLower := strings.ToLower(candidate)
			if strings.Contains(candidateLower, "ref") ||
				strings.Contains(candidateLower, "เลขที่รายการ") ||
				strings.Contains(candidateLower, "จำนวน") ||
				strings.Contains(candidateLower, "ค่าธรรมเนียม") ||
				strings.Contains(candidateLower, "amount") ||
				strings.Contains(candidateLower, "fee") ||
				strings.Contains(candidateLower, "qr") ||
				strings.HasPrefix(candidateLower, "<figure") {
				return false
			}
			if len([]rune(candidate)) >= 2 && !looksLikeAccountOrReference(candidate) {
				return true
			}
		}
	}
	return false
}

func looksLikeAccountOrReference(value string) bool {
	cleaned := strings.NewReplacer("-", "", " ", "", "x", "", "X", "").Replace(value)
	if cleaned == "" {
		return false
	}
	digits := 0
	for _, r := range cleaned {
		if r >= '0' && r <= '9' {
			digits++
		}
	}
	return digits >= 8
}

type ocrDocumentClassification struct {
	Type       string  `json:"type"`
	Confidence float64 `json:"confidence"`
}

// -----------------------------------------------------------------------------
// Slip post-processing
// -----------------------------------------------------------------------------
// Some slips contain both a shop name and a person's legal name. Prefer the shop
// name when it appears in the receiver block so the saved transaction is clearer.
func preferSlipReceiverMerchant(ocrText string, parsed *SlipData) {
	if parsed == nil {
		return
	}
	merchant := extractSlipDestinationMerchant(ocrText)
	if merchant == "" {
		return
	}
	if parsed.Receiver == nil || strings.TrimSpace(*parsed.Receiver) == "" || looksLikePersonalThaiName(*parsed.Receiver) {
		parsed.Receiver = &merchant
	}
}

func extractSlipDestinationMerchant(text string) string {
	lines := strings.Split(text, "\n")
	for i, line := range lines {
		current := strings.TrimSpace(line)
		lower := strings.ToLower(current)
		isDestinationCue := current == "↓" ||
			strings.Contains(lower, "receiver") ||
			strings.Contains(lower, "to account") ||
			strings.Contains(current, "ผู้รับ") ||
			strings.Contains(current, "ผู้รับเงิน") ||
			strings.Contains(current, "ไปยังบัญชี") ||
			strings.Contains(current, "ไปยัง")
		if !isDestinationCue {
			continue
		}
		for _, nextLine := range lines[i+1:] {
			candidate := strings.TrimSpace(nextLine)
			if candidate == "" {
				continue
			}
			candidateLower := strings.ToLower(candidate)
			if strings.Contains(candidateLower, "ref") ||
				strings.Contains(candidateLower, "เลขที่รายการ") ||
				strings.Contains(candidateLower, "จำนวน") ||
				strings.Contains(candidateLower, "ค่าธรรมเนียม") ||
				strings.Contains(candidateLower, "amount") ||
				strings.Contains(candidateLower, "fee") ||
				strings.Contains(candidateLower, "qr") ||
				strings.HasPrefix(candidateLower, "<figure") {
				return ""
			}
			if looksLikeAccountOrReference(candidate) || looksLikeBankName(candidate) {
				continue
			}
			return candidate
		}
	}
	return ""
}

func looksLikePersonalThaiName(value string) bool {
	v := strings.TrimSpace(value)
	prefixes := []string{
		"นาย ", "นาง ", "น.ส.", "น.ส ", "นางสาว ", "ด.ช.", "ด.ญ.",
		"mr.", "mrs.", "ms.", "miss ",
	}
	lower := strings.ToLower(v)
	for _, prefix := range prefixes {
		if strings.HasPrefix(lower, strings.ToLower(prefix)) {
			return true
		}
	}
	return false
}

func looksLikeBankName(value string) bool {
	v := strings.ToLower(strings.TrimSpace(value))
	keywords := []string{
		"ธ.", "ธนาคาร", "kbank", "scb", "krungthai", "ktb", "bangkok bank", "bbl",
		"kasikorn", "กสิกร", "ไทยพาณิชย์", "กรุงไทย", "กรุงเทพ", "กรุงศรี", "ออมสิน",
	}
	for _, keyword := range keywords {
		if strings.Contains(v, strings.ToLower(keyword)) {
			return true
		}
	}
	return false
}

// -----------------------------------------------------------------------------
// Image conversion helpers
// -----------------------------------------------------------------------------
// Typhoon OCR accepts JPG/PNG. HEIC/HEIF uploads are converted to JPEG by using
// ImageMagick or heif-convert when either tool is installed on the server.
func convertHEIC(data []byte) ([]byte, error) {
	if len(data) < 12 || string(data[4:8]) != "ftyp" {
		return nil, fmt.Errorf("not HEIC")
	}

	if converted, err := convertHEICWithMagick(data); err == nil {
		return converted, nil
	}
	if converted, err := convertHEICWithHeifConvert(data); err == nil {
		return converted, nil
	}

	return nil, fmt.Errorf("HEIC conversion requires ImageMagick (magick) or libheif (heif-convert)")
}

func convertHEICWithMagick(data []byte) ([]byte, error) {
	if _, err := exec.LookPath("magick"); err != nil {
		return nil, err
	}
	in, out, cleanup, err := writeTempHEIC(data)
	if err != nil {
		return nil, err
	}
	defer cleanup()

	if err := exec.Command("magick", in, out).Run(); err != nil {
		return nil, err
	}
	return os.ReadFile(out)
}

func convertHEICWithHeifConvert(data []byte) ([]byte, error) {
	if _, err := exec.LookPath("heif-convert"); err != nil {
		return nil, err
	}
	in, out, cleanup, err := writeTempHEIC(data)
	if err != nil {
		return nil, err
	}
	defer cleanup()

	if err := exec.Command("heif-convert", in, out).Run(); err != nil {
		return nil, err
	}
	return os.ReadFile(out)
}

func writeTempHEIC(data []byte) (string, string, func(), error) {
	dir, err := os.MkdirTemp("", "paomoney-heic-*")
	if err != nil {
		return "", "", nil, err
	}
	cleanup := func() { _ = os.RemoveAll(dir) }
	in := filepath.Join(dir, "input.heic")
	out := filepath.Join(dir, "output.jpg")
	if err := os.WriteFile(in, data, 0600); err != nil {
		cleanup()
		return "", "", nil, err
	}
	return in, out, cleanup, nil
}

func imageExtensionForMime(mimeType string) string {
	switch mimeType {
	case "image/png":
		return ".png"
	case "image/heic":
		return ".heic"
	case "image/heif":
		return ".heif"
	default:
		return ".jpg"
	}
}

func imageMimeForExtension(ext string) string {
	switch strings.ToLower(ext) {
	case ".png":
		return "image/png"
	case ".heic":
		return "image/heic"
	case ".heif":
		return "image/heif"
	default:
		return "image/jpeg"
	}
}

// -----------------------------------------------------------------------------
// Small database value helpers
// -----------------------------------------------------------------------------
func nilUUID(s string) interface{} {
	if s == "" {
		return nil
	}
	return s
}

func nilStr(s string) interface{} {
	if s == "" {
		return nil
	}
	return s
}

// -----------------------------------------------------------------------------
// API responses and handler setup
// -----------------------------------------------------------------------------
type ScanResultResp struct {
	ID           string       `json:"id"`
	JobID        string       `json:"job_id"`
	Status       string       `json:"status"`
	DocumentType string       `json:"document_type"`
	Filename     string       `json:"filename"`
	ImagePath    string       `json:"image_path"`
	OCRText      *string      `json:"ocr_text,omitempty"`
	Data         *ReceiptData `json:"data,omitempty"`
	Slip         *SlipData    `json:"slip,omitempty"`
	IsDuplicate  bool         `json:"is_duplicate"`
	ErrorMsg     *string      `json:"error_msg"`
	CreatedAt    string       `json:"created_at"`
}

type ScanJobResp struct {
	ID         string           `json:"id"`
	Status     string           `json:"status"`
	TotalCount int              `json:"total_count"`
	DoneCount  int              `json:"done_count"`
	ErrorMsg   *string          `json:"error_msg"`
	CreatedAt  string           `json:"created_at"`
	Results    []ScanResultResp `json:"results"`
}

type ScanHandler struct {
	db    *pgxpool.Pool
	cfg   *config.Config
	store *storage.Storage
}

func NewScanHandler(db *pgxpool.Pool, cfg *config.Config, store *storage.Storage) *ScanHandler {
	h := &ScanHandler{db: db, cfg: cfg, store: store}
	_ = h.ensureSchema(context.Background())
	return h
}

// ensureSchema owns only the unified scan tables used by /scan-jobs. The old
// receipt/slip job tables are no longer part of the active OCR flow.
func (h *ScanHandler) ensureSchema(ctx context.Context) error {
	_, err := h.db.Exec(ctx, `
		CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
		CREATE TABLE IF NOT EXISTS scan_jobs (
			id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
			user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
			status VARCHAR(20) NOT NULL DEFAULT 'pending',
			total_count INT NOT NULL DEFAULT 0,
			done_count INT NOT NULL DEFAULT 0,
			error_msg TEXT,
			created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
			updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
		);
		CREATE TABLE IF NOT EXISTS scan_results (
			id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
			job_id UUID NOT NULL REFERENCES scan_jobs(id) ON DELETE CASCADE,
			user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
			status VARCHAR(20) NOT NULL DEFAULT 'queued',
			document_type VARCHAR(20) NOT NULL DEFAULT 'unknown',
			filename VARCHAR(255),
			image_path TEXT,
			ocr_text TEXT,
			result_json JSONB,
			is_duplicate BOOLEAN NOT NULL DEFAULT FALSE,
			error_msg TEXT,
			created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
			updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
		);
		CREATE INDEX IF NOT EXISTS idx_scan_jobs_user_id ON scan_jobs(user_id);
		CREATE INDEX IF NOT EXISTS idx_scan_results_job_id ON scan_results(job_id);
	`)
	return err
}

// -----------------------------------------------------------------------------
// HTTP endpoints
// -----------------------------------------------------------------------------
// CreateJob saves up to 20 uploaded images, converts HEIC/HEIF to JPEG when
// possible, creates one scan_result per file, and starts background processing.
func (h *ScanHandler) CreateJob(c *gin.Context) {
	userID := c.GetString("user_id")
	if err := c.Request.ParseMultipartForm(160 << 20); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "ต้องส่งไฟล์แบบ multipart"})
		return
	}
	files := c.Request.MultipartForm.File["files"]
	if len(files) == 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "ไม่พบไฟล์"})
		return
	}
	if len(files) > 20 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "อัปโหลดได้สูงสุด 20 รูปต่อหนึ่งงานสแกน"})
		return
	}

	var jobID string
	if err := h.db.QueryRow(context.Background(),
		`INSERT INTO scan_jobs (user_id, status, total_count) VALUES ($1, 'pending', $2) RETURNING id`,
		userID, len(files),
	).Scan(&jobID); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	savedCount := 0
	for _, fh := range files {
		mimeType := fh.Header.Get("Content-Type")
		// Fallback: ถ้า browser ไม่ส่ง Content-Type ที่ถูกต้อง (เช่น HEIC บน Windows/Android) ให้เดาจากนามสกุล
		if mimeType == "" || mimeType == "application/octet-stream" {
			switch strings.ToLower(filepath.Ext(fh.Filename)) {
			case ".jpg", ".jpeg":
				mimeType = "image/jpeg"
			case ".png":
				mimeType = "image/png"
			case ".heic":
				mimeType = "image/heic"
			case ".heif":
				mimeType = "image/heif"
			}
		}
		allowed := map[string]bool{
			"image/jpeg": true, "image/jpg": true, "image/png": true, "image/heic": true, "image/heif": true,
		}
		if !allowed[mimeType] {
			continue
		}

		f, err := fh.Open()
		if err != nil {
			continue
		}
		data, _ := io.ReadAll(f)
		_ = f.Close()

		if mimeType == "image/heic" || mimeType == "image/heif" {
			if converted, err := convertHEIC(data); err == nil {
				data = converted
				mimeType = "image/jpeg"
			}
		}

		ext := imageExtensionForMime(mimeType)
		key := fmt.Sprintf("scans/%s_%d%s", jobID[:8], time.Now().UnixNano(), ext)
		loc, err := h.store.Upload(context.Background(), key, mimeType, data)
		if err != nil {
			continue
		}

		if _, err := h.db.Exec(context.Background(),
			`INSERT INTO scan_results (job_id, user_id, status, filename, image_path)
			 VALUES ($1, $2, 'queued', $3, $4)`,
			jobID, userID, fh.Filename, loc,
		); err != nil {
			continue
		}
		savedCount++
	}

	if savedCount == 0 {
		h.db.Exec(context.Background(), `DELETE FROM scan_jobs WHERE id=$1`, jobID)
		c.JSON(http.StatusBadRequest, gin.H{"error": "ไม่มีไฟล์ที่รองรับ (jpg, png, heic)"})
		return
	}
	h.db.Exec(context.Background(), `UPDATE scan_jobs SET total_count=$1 WHERE id=$2`, savedCount, jobID)
	go h.processJob(jobID, userID)
	c.JSON(http.StatusOK, gin.H{"job_id": jobID, "total": savedCount})
}

func (h *ScanHandler) GetJob(c *gin.Context) {
	job, err := h.fetchJob(c.Param("id"), c.GetString("user_id"))
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "ไม่พบ job"})
		return
	}
	c.JSON(http.StatusOK, job)
}

func (h *ScanHandler) ListJobs(c *gin.Context) {
	userID := c.GetString("user_id")
	rows, err := h.db.Query(context.Background(),
		`SELECT id, status, total_count, done_count, error_msg, created_at::text
		 FROM scan_jobs WHERE user_id=$1 ORDER BY created_at DESC LIMIT 10`,
		userID,
	)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	defer rows.Close()

	jobs := []ScanJobResp{}
	for rows.Next() {
		var j ScanJobResp
		if err := rows.Scan(&j.ID, &j.Status, &j.TotalCount, &j.DoneCount, &j.ErrorMsg, &j.CreatedAt); err == nil {
			jobs = append(jobs, j)
		}
	}
	c.JSON(http.StatusOK, jobs)
}

func (h *ScanHandler) CancelJob(c *gin.Context) {
	jobID := c.Param("id")
	userID := c.GetString("user_id")
	ctx := context.Background()
	tag, err := h.db.Exec(ctx,
		`UPDATE scan_jobs SET status='cancelled', updated_at=NOW()
		 WHERE id=$1 AND user_id=$2 AND status IN ('pending','processing')`,
		jobID, userID,
	)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	if tag.RowsAffected() == 0 {
		c.JSON(http.StatusNotFound, gin.H{"error": "ไม่พบ job ที่ยกเลิกได้"})
		return
	}
	h.db.Exec(ctx,
		`UPDATE scan_results SET status='cancelled', updated_at=NOW()
		 WHERE job_id=$1 AND user_id=$2 AND status IN ('queued','ocr','classifying','parsing')`,
		jobID, userID,
	)
	c.JSON(http.StatusOK, gin.H{"status": "cancelled"})
}

func (h *ScanHandler) MarkResultSaved(c *gin.Context) {
	userID := c.GetString("user_id")
	jobID := c.Param("id")
	resultID := c.Param("result_id")
	tag, err := h.db.Exec(context.Background(),
		`UPDATE scan_results SET status='saved', updated_at=NOW()
		 WHERE id=$1 AND job_id=$2 AND user_id=$3 AND status='done'`,
		resultID, jobID, userID,
	)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	if tag.RowsAffected() == 0 {
		c.JSON(http.StatusNotFound, gin.H{"error": "ไม่พบผลสแกนที่บันทึกได้"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"status": "saved"})
}

func (h *ScanHandler) SaveSlipResult(c *gin.Context) {
	userID := c.GetString("user_id")
	jobID := c.Param("id")
	resultID := c.Param("result_id")

	var body struct {
		AccountID       string  `json:"account_id"`
		CategoryID      string  `json:"category_id"`
		TxType          string  `json:"tx_type"`
		Amount          float64 `json:"amount"`
		Name            string  `json:"name"`
		TransactionDate string  `json:"transaction_date"`
		Note            string  `json:"note"`
		RefNo           string  `json:"ref_no"`
		ImagePath       string  `json:"image_path"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if body.AccountID == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "กรุณาเลือกบัญชี"})
		return
	}
	if body.Amount <= 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "ยอดเงินต้องมากกว่า 0"})
		return
	}

	txType := "income"
	if body.TxType == "expense" {
		txType = "expense"
	}
	if body.TransactionDate == "" {
		body.TransactionDate = time.Now().Format("2006-01-02")
	}

	ctx := context.Background()
	dbTx, err := h.db.Begin(ctx)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to begin transaction"})
		return
	}
	defer dbTx.Rollback(ctx)

	var txID string
	if err := dbTx.QueryRow(ctx,
		`INSERT INTO transactions
		 (user_id, account_id, category_id, type, amount, name, note, transaction_date, image_path)
		 VALUES ($1,$2,$3,$4,$5,$6,$7,$8::date,$9) RETURNING id`,
		userID, body.AccountID, nilUUID(body.CategoryID), txType, body.Amount,
		nilStr(body.Name), body.Note, body.TransactionDate, nilStr(body.ImagePath),
	).Scan(&txID); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	if txType == "income" {
		err = creditAccount(ctx, dbTx, userID, body.AccountID, body.Amount)
	} else {
		err = debitAccount(ctx, dbTx, userID, body.AccountID, body.Amount)
	}
	if err != nil {
		status := http.StatusInternalServerError
		if err == errInsufficientFunds || err == errAccountNotFound {
			status = http.StatusBadRequest
		}
		c.JSON(status, gin.H{"error": balanceErrorMessage(err)})
		return
	}

	if body.RefNo != "" {
		if _, err := dbTx.Exec(ctx,
			`INSERT INTO slip_ref_log (user_id, ref_no, transaction_id)
			 VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
			userID, body.RefNo, txID,
		); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to save slip reference"})
			return
		}
	}

	if _, err := dbTx.Exec(ctx,
		`UPDATE scan_results SET status='saved', updated_at=NOW()
		 WHERE id=$1 AND job_id=$2 AND user_id=$3 AND document_type='slip'`,
		resultID, jobID, userID,
	); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to update scan result"})
		return
	}
	if err := dbTx.Commit(ctx); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to commit transaction"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"transaction_id": txID})
}

func (h *ScanHandler) SkipResult(c *gin.Context) {
	userID := c.GetString("user_id")
	jobID := c.Param("id")
	resultID := c.Param("result_id")
	tag, err := h.db.Exec(context.Background(),
		`UPDATE scan_results SET status='skipped', updated_at=NOW()
		 WHERE id=$1 AND job_id=$2 AND user_id=$3 AND status IN ('done','rejected','error')`,
		resultID, jobID, userID,
	)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	if tag.RowsAffected() == 0 {
		c.JSON(http.StatusNotFound, gin.H{"error": "ไม่พบผลสแกนที่ข้ามได้"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"status": "skipped"})
}

// -----------------------------------------------------------------------------
// Job loading and background processing
// -----------------------------------------------------------------------------
func (h *ScanHandler) fetchJob(jobID, userID string) (*ScanJobResp, error) {
	var job ScanJobResp
	if err := h.db.QueryRow(context.Background(),
		`SELECT id, status, total_count, done_count, error_msg, created_at::text
		 FROM scan_jobs WHERE id=$1 AND user_id=$2`,
		jobID, userID,
	).Scan(&job.ID, &job.Status, &job.TotalCount, &job.DoneCount, &job.ErrorMsg, &job.CreatedAt); err != nil {
		return nil, err
	}

	rows, err := h.db.Query(context.Background(),
		`SELECT id, job_id, status, document_type, COALESCE(filename,''), COALESCE(image_path,''),
		        ocr_text, result_json::text, is_duplicate, error_msg, created_at::text
		 FROM scan_results WHERE job_id=$1 AND user_id=$2 ORDER BY created_at`,
		jobID, userID,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	job.Results = []ScanResultResp{}
	for rows.Next() {
		var r ScanResultResp
		var raw *string
		if err := rows.Scan(
			&r.ID, &r.JobID, &r.Status, &r.DocumentType, &r.Filename, &r.ImagePath,
			&r.OCRText, &raw, &r.IsDuplicate, &r.ErrorMsg, &r.CreatedAt,
		); err != nil {
			continue
		}
		if raw != nil && *raw != "" {
			if r.DocumentType == scanDocReceipt {
				var d ReceiptData
				if json.Unmarshal([]byte(*raw), &d) == nil {
					r.Data = &d
				}
			} else if r.DocumentType == scanDocSlip {
				var s SlipData
				if json.Unmarshal([]byte(*raw), &s) == nil {
					r.Slip = &s
				}
			}
		}
		job.Results = append(job.Results, r)
	}
	return &job, nil
}

func (h *ScanHandler) processJob(jobID, userID string) {
	ctx := context.Background()
	tag, err := h.db.Exec(ctx,
		`UPDATE scan_jobs SET status='processing', updated_at=NOW()
		 WHERE id=$1 AND status <> 'cancelled'`,
		jobID,
	)
	if err != nil || tag.RowsAffected() == 0 {
		return
	}

	rows, err := h.db.Query(ctx,
		`SELECT id, image_path, filename FROM scan_results
		 WHERE job_id=$1 AND status='queued' ORDER BY created_at`,
		jobID,
	)
	if err != nil {
		h.db.Exec(ctx, `UPDATE scan_jobs SET status='error', error_msg=$2, updated_at=NOW() WHERE id=$1`, jobID, err.Error())
		return
	}
	type scanInfo struct{ id, imagePath, filename string }
	items := []scanInfo{}
	for rows.Next() {
		var item scanInfo
		if err := rows.Scan(&item.id, &item.imagePath, &item.filename); err == nil {
			items = append(items, item)
		}
	}
	rows.Close()

	for _, item := range items {
		if h.isJobCancelled(ctx, jobID) {
			return
		}
		h.processOne(ctx, item.id, item.imagePath, item.filename, userID)
	}
	if !h.isJobCancelled(ctx, jobID) {
		h.db.Exec(ctx, `UPDATE scan_jobs SET status='done', updated_at=NOW() WHERE id=$1`, jobID)
	}
}

// processOne runs the full OCR pipeline for a single uploaded image:
// 1. read the stored image
// 2. run Typhoon OCR
// 3. classify as receipt, slip, or unknown
// 4. parse JSON with the matching prompt
// 5. store parsed data, reject the image, or mark slip duplicates
func (h *ScanHandler) processOne(ctx context.Context, resultID, imagePath, filename, userID string) {
	complete := func(status, docType, msg string, result any, isDuplicate bool) {
		var raw any
		if result != nil {
			if b, err := json.Marshal(result); err == nil {
				raw = string(b)
			}
		}
		if docType == "" {
			docType = scanDocUnknown
		}
		h.db.Exec(ctx,
			`UPDATE scan_results
			 SET status=$1, document_type=$2, result_json=$3::jsonb, is_duplicate=$4, error_msg=$5, updated_at=NOW()
			 WHERE id=$6`,
			status, docType, raw, isDuplicate, nilStr(msg), resultID,
		)
		h.db.Exec(ctx,
			`UPDATE scan_jobs SET done_count=done_count+1, updated_at=NOW()
			 WHERE id=(SELECT job_id FROM scan_results WHERE id=$1)`,
			resultID,
		)
	}
	fail := func(msg string) { complete("error", scanDocUnknown, msg, nil, false) }
	rejectAs := func(docType, msg string) { complete("rejected", docType, msg, nil, false) }
	reject := func(msg string) { rejectAs(scanDocUnknown, msg) }

	imageBytes, err := h.store.Download(ctx, imagePath)
	if err != nil {
		fail(fmt.Sprintf("อ่านไฟล์ไม่ได้: %v", err))
		return
	}
	mimeType := imageMimeForExtension(filepath.Ext(imagePath))

	h.db.Exec(ctx, `UPDATE scan_results SET status='ocr', updated_at=NOW() WHERE id=$1`, resultID)
	ocrText, err := h.callFinancialOCR(imageBytes, mimeType)
	if err != nil {
		fail(fmt.Sprintf("อ่านรูปไม่สำเร็จ: %v", err))
		return
	}
	h.db.Exec(ctx, `UPDATE scan_results SET ocr_text=$1, updated_at=NOW() WHERE id=$2`, ocrText, resultID)

	// classifyOCRDocument ตัดสินจากโครงสร้างก่อน ถ้าก้ำกึ่ง/ไม่ชัด (unknown) ค่อยถาม LLM
	docType := classifyOCRDocument(ocrText)
	if docType == ocrDocUnknown {
		if classified, confidence, err := h.callOCRDocumentClassifier(ocrText); err == nil && confidence >= 0.6 {
			docType = classified
		}
	}

	h.db.Exec(ctx, `UPDATE scan_results SET status='parsing', document_type=$1, updated_at=NOW() WHERE id=$2`, string(docType), resultID)
	time.Sleep(2 * time.Second)

	parseSlip := func() {
		h.db.Exec(ctx, `UPDATE scan_results SET status='parsing', document_type=$1, updated_at=NOW() WHERE id=$2`, string(ocrDocSlip), resultID)

		parsed, err := h.callTyphoonParser(ocrText)
		if err != nil {
			fail(fmt.Sprintf("แปลงผลสลิปไม่สำเร็จ: %v", err))
			return
		}
		preferSlipReceiverMerchant(ocrText, parsed)
		if !hasSlipTransferEvidence(ocrText, parsed) {
			rejectAs(scanDocSlip, "รูปนี้ดูไม่ใช่สลิปโอนเงิน หรืออ่านข้อมูลสำคัญไม่พบ")
			return
		}
		isDuplicate := false
		if parsed.RefNo != nil && strings.TrimSpace(*parsed.RefNo) != "" {
			var cnt int
			_ = h.db.QueryRow(ctx,
				`SELECT COUNT(*) FROM slip_ref_log WHERE user_id=$1 AND ref_no=$2`,
				userID, *parsed.RefNo,
			).Scan(&cnt)
			isDuplicate = cnt > 0
		}
		complete("done", scanDocSlip, "", parsed, isDuplicate)
	}

	switch docType {
	case ocrDocReceipt:
		parsed, err := h.callReceiptParser(ocrText)
		if err != nil {
			fail(fmt.Sprintf("แปลงผลใบเสร็จไม่สำเร็จ: %v", err))
			return
		}
		if looksLikeSlipInReceiptFlow(ocrText, parsed) {
			parseSlip()
			return
		}
		if looksInvalidReceipt(parsed) {
			reject("รูปนี้อ่านข้อมูลใบเสร็จไม่ครบ กรุณาใช้รูปที่เห็นวันที่ รายการ และราคาอย่างชัดเจน")
			return
		}
		complete("done", scanDocReceipt, "", parsed, false)
	case ocrDocSlip:
		parseSlip()
	default:
		reject("รูปนี้ไม่พบข้อมูลใบเสร็จหรือสลิปโอนเงินที่ชัดเจน")
	}
	_ = filename
}

func (h *ScanHandler) isJobCancelled(ctx context.Context, jobID string) bool {
	var status string
	if err := h.db.QueryRow(ctx, `SELECT status FROM scan_jobs WHERE id=$1`, jobID).Scan(&status); err != nil {
		return true
	}
	return status == "cancelled"
}

// -----------------------------------------------------------------------------
// Typhoon OCR / Typhoon Instruct integrations
// -----------------------------------------------------------------------------
func (h *ScanHandler) callFinancialOCR(imageBytes []byte, mimeType string) (string, error) {
	if err := llm.WaitTyphoonOCR(context.Background()); err != nil {
		return "", err
	}

	var buf bytes.Buffer
	w := multipart.NewWriter(&buf)
	ext := "jpg"
	if mimeType == "image/png" {
		ext = "png"
	}
	mh := make(textproto.MIMEHeader)
	mh.Set("Content-Disposition", fmt.Sprintf(`form-data; name="file"; filename="scan.%s"`, ext))
	mh.Set("Content-Type", mimeType)
	part, err := w.CreatePart(mh)
	if err != nil {
		return "", err
	}
	part.Write(imageBytes)
	w.WriteField("model", "typhoon-ocr")
	w.WriteField("task_type", "Read all text from this financial document. It may be a receipt, bill, bank slip, PromptPay slip, or transfer proof. Preserve dates, names, item prices, totals, amounts, and reference codes accurately.")
	w.WriteField("max_tokens", "2000")
	w.WriteField("temperature", "0")
	w.WriteField("top_p", "0.6")
	w.Close()

	req, err := http.NewRequest("POST", h.cfg.Typhoon.BaseURL+"/ocr", &buf)
	if err != nil {
		return "", err
	}
	req.Header.Set("Authorization", "Bearer "+h.cfg.Typhoon.APIKey)
	req.Header.Set("Content-Type", w.FormDataContentType())

	client := &http.Client{Timeout: 120 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		b, _ := io.ReadAll(resp.Body)
		return "", fmt.Errorf("Typhoon OCR %d: %s", resp.StatusCode, string(b))
	}

	var result typhoonOCRResp
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return "", fmt.Errorf("decode OCR response: %v", err)
	}
	for _, r := range result.Results {
		if r.Success && len(r.Message.Choices) > 0 {
			return r.Message.Choices[0].Message.Content, nil
		}
	}
	return "", fmt.Errorf("ไม่ได้ข้อความกลับมา")
}

func (h *ScanHandler) callOCRDocumentClassifier(ocrText string) (ocrDocType, float64, error) {
	if err := llm.WaitTyphoonLLM(context.Background()); err != nil {
		return ocrDocUnknown, 0, err
	}

	payload := llm.LLMChatReq{
		Model: h.cfg.Typhoon.ExtractModel,
		Messages: []llm.LLMChatMsg{
			{Role: "system", Content: ocrDocumentClassifierPrompt},
			{Role: "user", Content: "ข้อความ OCR:\n\n" + ocrText},
		},
		MaxTokens:   120,
		Temperature: 0,
		TopP:        0.4,
	}

	body, _ := json.Marshal(payload)
	req, err := http.NewRequest("POST", h.cfg.Typhoon.BaseURL+"/chat/completions", bytes.NewReader(body))
	if err != nil {
		return ocrDocUnknown, 0, err
	}
	req.Header.Set("Authorization", "Bearer "+h.cfg.Typhoon.APIKey)
	req.Header.Set("Content-Type", "application/json")

	client := &http.Client{Timeout: 30 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return ocrDocUnknown, 0, err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		b, _ := io.ReadAll(resp.Body)
		return ocrDocUnknown, 0, fmt.Errorf("Typhoon classifier %d: %s", resp.StatusCode, string(b))
	}

	var llmResp llm.LLMChatResp
	if err := json.NewDecoder(resp.Body).Decode(&llmResp); err != nil {
		return ocrDocUnknown, 0, fmt.Errorf("decode classifier response: %v", err)
	}
	if len(llmResp.Choices) == 0 {
		return ocrDocUnknown, 0, fmt.Errorf("classifier ไม่มีผลลัพธ์กลับมา")
	}

	content := strings.TrimSpace(llmResp.Choices[0].Message.Content)
	content = strings.TrimPrefix(content, "```json")
	content = strings.TrimPrefix(content, "```")
	content = strings.TrimSuffix(content, "```")
	content = strings.TrimSpace(content)

	var result ocrDocumentClassification
	if err := json.Unmarshal([]byte(content), &result); err != nil {
		return ocrDocUnknown, 0, fmt.Errorf("parse classifier JSON ไม่ได้: %v | content: %s", err, content)
	}

	switch strings.ToLower(strings.TrimSpace(result.Type)) {
	case string(ocrDocReceipt):
		return ocrDocReceipt, result.Confidence, nil
	case string(ocrDocSlip):
		return ocrDocSlip, result.Confidence, nil
	default:
		return ocrDocUnknown, result.Confidence, nil
	}
}

func (h *ScanHandler) callReceiptParser(ocrText string) (*ReceiptData, error) {
	if err := llm.WaitTyphoonLLM(context.Background()); err != nil {
		return nil, err
	}

	payload := llm.LLMChatReq{
		Model: h.cfg.Typhoon.ExtractModel,
		Messages: []llm.LLMChatMsg{
			{Role: "system", Content: receiptParserPrompt},
			{Role: "user", Content: "ข้อความจาก OCR ใบเสร็จ:\n\n" + ocrText},
		},
		MaxTokens:   1200,
		Temperature: 0.2,
		TopP:        0.6,
	}

	body, _ := json.Marshal(payload)
	req, err := http.NewRequest("POST", h.cfg.Typhoon.BaseURL+"/chat/completions", bytes.NewReader(body))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Authorization", "Bearer "+h.cfg.Typhoon.APIKey)
	req.Header.Set("Content-Type", "application/json")

	client := &http.Client{Timeout: 60 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		b, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("Typhoon LLM %d: %s", resp.StatusCode, string(b))
	}

	var llmResp llm.LLMChatResp
	if err := json.NewDecoder(resp.Body).Decode(&llmResp); err != nil {
		return nil, fmt.Errorf("decode LLM response: %v", err)
	}
	if len(llmResp.Choices) == 0 {
		return nil, fmt.Errorf("LLM ไม่ได้ผลลัพธ์กลับมา")
	}

	content := llmResp.Choices[0].Message.Content
	content = strings.TrimPrefix(content, "```json")
	content = strings.TrimPrefix(content, "```")
	content = strings.TrimSuffix(content, "```")
	content = strings.TrimSpace(content)

	var result ReceiptData
	if err := json.Unmarshal([]byte(content), &result); err != nil {
		return nil, fmt.Errorf("parse JSON ไม่ได้: %v | content: %s", err, content)
	}
	if result.Items == nil {
		result.Items = []ReceiptItem{}
	}
	normalizeReceiptOCRDate(&result, ocrText)
	sanitizeReceiptData(&result)
	if result.VAT != nil && result.VAT.Amount <= 0 {
		result.VAT = nil
	}
	if result.Discount != nil && result.Discount.Amount <= 0 {
		result.Discount = nil
	}
	return &result, nil
}

func (h *ScanHandler) callTyphoonParser(ocrText string) (*SlipData, error) {
	if err := llm.WaitTyphoonLLM(context.Background()); err != nil {
		return nil, err
	}

	payload := llm.LLMChatReq{
		Model: h.cfg.Typhoon.ExtractModel,
		Messages: []llm.LLMChatMsg{
			{Role: "system", Content: slipParserPrompt},
			{Role: "user", Content: "ข้อความจาก OCR สลิปธนาคาร:\n\n" + ocrText},
		},
		MaxTokens:   512,
		Temperature: 0.3,
		TopP:        0.6,
	}

	body, _ := json.Marshal(payload)
	req, err := http.NewRequest("POST", h.cfg.Typhoon.BaseURL+"/chat/completions", bytes.NewReader(body))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Authorization", "Bearer "+h.cfg.Typhoon.APIKey)
	req.Header.Set("Content-Type", "application/json")

	client := &http.Client{Timeout: 60 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		b, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("Typhoon LLM %d: %s", resp.StatusCode, string(b))
	}

	var llmResp llm.LLMChatResp
	if err := json.NewDecoder(resp.Body).Decode(&llmResp); err != nil {
		return nil, fmt.Errorf("decode LLM response: %v", err)
	}
	if len(llmResp.Choices) == 0 {
		return nil, fmt.Errorf("LLM ไม่ได้ผลลัพธ์กลับมา")
	}

	content := llmResp.Choices[0].Message.Content
	content = strings.TrimPrefix(content, "```json")
	content = strings.TrimPrefix(content, "```")
	content = strings.TrimSuffix(content, "```")
	content = strings.TrimSpace(content)

	var result SlipData
	if err := json.Unmarshal([]byte(content), &result); err != nil {
		return nil, fmt.Errorf("parse JSON ไม่ได้: %v | content: %s", err, content)
	}
	normalizeSlipOCRDate(&result, ocrText)
	return &result, nil
}
