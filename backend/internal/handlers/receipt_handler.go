package handlers

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
	"path/filepath"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5/pgxpool"
	"paomoney/internal/config"
)

// ─── Response structs ─────────────────────────────────────────────────────────

type ReceiptItem struct {
	Name      string  `json:"name"`
	Quantity  float64 `json:"quantity"`
	UnitPrice float64 `json:"unit_price"`
	Note      string  `json:"note"`
}

type ReceiptData struct {
	Merchant *string       `json:"merchant"`
	Date     *string       `json:"date"`
	Items    []ReceiptItem `json:"items"`
}

type ReceiptJobResp struct {
	ID        string       `json:"id"`
	Status    string       `json:"status"`
	ImagePath string       `json:"image_path"`
	Filename  string       `json:"filename"`
	Data      *ReceiptData `json:"data"`
	ErrorMsg  *string      `json:"error_msg"`
	CreatedAt string       `json:"created_at"`
}

// ─── Handler ──────────────────────────────────────────────────────────────────

type ReceiptHandler struct {
	db  *pgxpool.Pool
	cfg *config.Config
}

func NewReceiptHandler(db *pgxpool.Pool, cfg *config.Config) *ReceiptHandler {
	return &ReceiptHandler{db: db, cfg: cfg}
}

// ─── POST /api/v1/receipt-jobs ────────────────────────────────────────────────
func (h *ReceiptHandler) CreateJob(c *gin.Context) {
	userID := c.GetString("user_id")

	file, fh, err := c.Request.FormFile("file")
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "ต้องส่งไฟล์ (field: file)"})
		return
	}
	defer file.Close()

	mimeType := fh.Header.Get("Content-Type")
	allowed := map[string]bool{
		"image/jpeg": true, "image/jpg": true,
		"image/png": true, "image/heic": true, "image/heif": true,
	}
	if !allowed[mimeType] {
		c.JSON(http.StatusBadRequest, gin.H{"error": "รองรับเฉพาะ jpg, png, heic"})
		return
	}

	data, _ := io.ReadAll(file)

	// แปลง HEIC → JPEG
	if mimeType == "image/heic" || mimeType == "image/heif" {
		if converted, err := convertHEIC(data); err == nil {
			data = converted
			mimeType = "image/jpeg"
		}
	}

	uploadsDir := "uploads/receipts"
	os.MkdirAll(uploadsDir, 0755)

	// สร้าง job
	var jobID string
	if err := h.db.QueryRow(context.Background(),
		`INSERT INTO receipt_jobs (user_id, status, filename) VALUES ($1, 'pending', $2) RETURNING id`,
		userID, fh.Filename,
	).Scan(&jobID); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	// บันทึกไฟล์
	ext := ".jpg"
	if mimeType == "image/png" {
		ext = ".png"
	}
	filename := fmt.Sprintf("%s_%d%s", jobID[:8], time.Now().UnixNano(), ext)
	filePath := filepath.Join(uploadsDir, filename)
	if err := os.WriteFile(filePath, data, 0644); err != nil {
		h.db.Exec(context.Background(), `DELETE FROM receipt_jobs WHERE id=$1`, jobID)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "บันทึกไฟล์ไม่สำเร็จ"})
		return
	}

	h.db.Exec(context.Background(),
		`UPDATE receipt_jobs SET image_path=$1 WHERE id=$2`,
		"/"+filePath, jobID,
	)

	go h.processReceipt(jobID, mimeType, data)

	c.JSON(http.StatusOK, gin.H{"job_id": jobID})
}

// ─── GET /api/v1/receipt-jobs/:id ────────────────────────────────────────────
func (h *ReceiptHandler) GetJob(c *gin.Context) {
	jobID := c.Param("id")
	userID := c.GetString("user_id")

	var resp ReceiptJobResp
	var resultJSON *string

	if err := h.db.QueryRow(context.Background(),
		`SELECT id, status, COALESCE(image_path,''), COALESCE(filename,''),
		        result_json, error_msg, created_at::text
		 FROM receipt_jobs WHERE id=$1 AND user_id=$2`,
		jobID, userID,
	).Scan(
		&resp.ID, &resp.Status, &resp.ImagePath, &resp.Filename,
		&resultJSON, &resp.ErrorMsg, &resp.CreatedAt,
	); err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "ไม่พบ job"})
		return
	}

	if resultJSON != nil && *resultJSON != "" {
		var d ReceiptData
		if json.Unmarshal([]byte(*resultJSON), &d) == nil {
			resp.Data = &d
		}
	}

	c.JSON(http.StatusOK, resp)
}

// ─── Background worker ────────────────────────────────────────────────────────
func (h *ReceiptHandler) processReceipt(jobID, mimeType string, imageData []byte) {
	ctx := context.Background()

	setStatus := func(status, errMsg string) {
		if errMsg != "" {
			h.db.Exec(ctx,
				`UPDATE receipt_jobs SET status=$1, error_msg=$2, updated_at=NOW() WHERE id=$3`,
				status, errMsg, jobID,
			)
		} else {
			h.db.Exec(ctx,
				`UPDATE receipt_jobs SET status=$1, updated_at=NOW() WHERE id=$2`,
				status, jobID,
			)
		}
	}

	// Step 1: OCR
	setStatus("ocr", "")
	ocrText, err := h.callReceiptOCR(imageData, mimeType)
	if err != nil {
		setStatus("error", "OCR ล้มเหลว: "+err.Error())
		return
	}

	// Step 2: Parse
	setStatus("parsing", "")
	time.Sleep(2 * time.Second)

	parsed, err := h.callReceiptParser(ocrText)
	if err != nil {
		setStatus("error", "แปลผลล้มเหลว: "+err.Error())
		return
	}

	resultBytes, _ := json.Marshal(parsed)
	h.db.Exec(ctx,
		`UPDATE receipt_jobs SET status='done', result_json=$1, updated_at=NOW() WHERE id=$2`,
		string(resultBytes), jobID,
	)
}

// ─── Typhoon OCR ──────────────────────────────────────────────────────────────
func (h *ReceiptHandler) callReceiptOCR(imageBytes []byte, mimeType string) (string, error) {
	var buf bytes.Buffer
	w := multipart.NewWriter(&buf)

	ext := "jpg"
	if mimeType == "image/png" {
		ext = "png"
	}
	mh := make(textproto.MIMEHeader)
	mh.Set("Content-Disposition", fmt.Sprintf(`form-data; name="file"; filename="receipt.%s"`, ext))
	mh.Set("Content-Type", mimeType)
	part, err := w.CreatePart(mh)
	if err != nil {
		return "", err
	}
	part.Write(imageBytes)

	w.WriteField("model", "typhoon-ocr")
	w.WriteField("task_type", "Read all text from this receipt or bill document exactly as it appears. Preserve item names, quantities, prices, dates, and store names accurately.")
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

	// reuse typhoonOCRResp defined in slip_handler.go (same package)
	var result typhoonOCRResp
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return "", fmt.Errorf("decode OCR response: %v", err)
	}
	for _, r := range result.Results {
		if r.Success && len(r.Message.Choices) > 0 {
			return r.Message.Choices[0].Message.Content, nil
		}
	}
	return "", fmt.Errorf("OCR ไม่ได้ข้อความกลับมา")
}

// ─── Typhoon LLM Parser ───────────────────────────────────────────────────────
var receiptParserPrompt = `คุณคือผู้ช่วยดึงข้อมูลจากข้อความ OCR ของใบเสร็จ/บิล
ตอบเป็น JSON เท่านั้น ห้ามมีข้อความหรือ markdown อื่น
รูปแบบ:
{
  "merchant": "ชื่อร้านหรือสถานที่",
  "date": "YYYY-MM-DD",
  "items": [
    {"name": "ชื่อรายการ", "quantity": 1.0, "unit_price": 0.00, "note": ""}
  ]
}
กฎทั่วไป:
- ตอบ JSON เท่านั้น ไม่มี markdown หรือ code block
- ถ้าหาไม่เจอให้ใส่ null (สำหรับ merchant, date) หรือ [] (สำหรับ items)
- date: แปลงเป็น YYYY-MM-DD (วันที่ พ.ศ. ให้ลบ 543 ก่อน)
- quantity: จำนวนหน่วย เป็น float เช่น 1.0 (ถ้าไม่ชัดให้ใส่ 1.0)
- unit_price: ราคาต่อหน่วยสุทธิ เป็น float ไม่มี comma (ต้องหักส่วนลดแล้ว)
- ถ้าในใบเสร็จมีราคารวมสำหรับหลายหน่วย ให้หารด้วย quantity เพื่อได้ unit_price
- note: ปกติใส่ "" แต่ถ้า item มีส่วนลดให้ใส่ข้อความเช่น "มีส่วนลด 5.00 บาท"

กฎการจัดการส่วนลด (สำคัญมาก):
- บรรทัดที่มีคำว่า "ส่วนลด", "discount", "จัดส่งฟรี", "ลด", หรือมีค่าติดลบ ให้ถือว่าเป็นส่วนลด ห้ามสร้างเป็น item แยก
- ถ้าบรรทัดส่วนลดระบุชื่อสินค้าชัดเจน เช่น "ส่วนลด โค้ก -5.00" ให้หักออกจาก unit_price ของ item ที่มีชื่อตรงกันหรือใกล้เคียงที่สุด
- ถ้าบรรทัดส่วนลดไม่ระบุชื่อสินค้า เช่น "ส่วนลด -5.00" ให้หักออกจาก unit_price ของ item บรรทัดก่อนหน้าทันที
- เมื่อหักส่วนลดแล้ว ให้ใส่ note ว่า "มีส่วนลด X.XX บาท" (X.XX คือจำนวนเงินส่วนลด)
- ถ้า unit_price หลังหักส่วนลดติดลบหรือเป็น 0 ให้ใส่ unit_price = 0`

func (h *ReceiptHandler) callReceiptParser(ocrText string) (*ReceiptData, error) {
	// reuse llmChatReq, llmChatMsg, llmChatResp from slip_handler.go (same package)
	payload := llmChatReq{
		Model: h.cfg.Typhoon.ExtractModel,
		Messages: []llmChatMsg{
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

	var llmResp llmChatResp
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
	return &result, nil
}
