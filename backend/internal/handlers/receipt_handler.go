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
	"regexp"
	"strconv"
	"strings"
	"time"

	"paomoney/internal/config"

	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5/pgxpool"
)

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

type ReceiptResultResp struct {
	ID        string       `json:"id"`
	JobID     string       `json:"job_id"`
	Status    string       `json:"status"`
	ImagePath string       `json:"image_path"`
	Filename  string       `json:"filename"`
	Data      *ReceiptData `json:"data"`
	ErrorMsg  *string      `json:"error_msg"`
	CreatedAt string       `json:"created_at"`
}

type ReceiptJobResp struct {
	ID         string              `json:"id"`
	Status     string              `json:"status"`
	TotalCount int                 `json:"total_count"`
	DoneCount  int                 `json:"done_count"`
	ImagePath  string              `json:"image_path,omitempty"`
	Filename   string              `json:"filename,omitempty"`
	Data       *ReceiptData        `json:"data,omitempty"`
	ErrorMsg   *string             `json:"error_msg"`
	CreatedAt  string              `json:"created_at"`
	Receipts   []ReceiptResultResp `json:"receipts"`
}

type ReceiptHandler struct {
	db  *pgxpool.Pool
	cfg *config.Config
}

func NewReceiptHandler(db *pgxpool.Pool, cfg *config.Config) *ReceiptHandler {
	return &ReceiptHandler{db: db, cfg: cfg}
}

func (h *ReceiptHandler) CreateJob(c *gin.Context) {
	userID := c.GetString("user_id")

	if err := c.Request.ParseMultipartForm(60 << 20); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "ต้องส่งไฟล์แบบ multipart"})
		return
	}

	files := c.Request.MultipartForm.File["files"]
	if len(files) == 0 {
		files = c.Request.MultipartForm.File["file"]
	}
	if len(files) == 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "ไม่พบไฟล์ใบเสร็จ"})
		return
	}
	if len(files) > 5 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "อัปโหลดใบเสร็จได้สูงสุด 5 ใบต่อครั้ง"})
		return
	}

	uploadsDir := "uploads/receipts"
	_ = os.MkdirAll(uploadsDir, 0755)

	var jobID string
	if err := h.db.QueryRow(context.Background(),
		`INSERT INTO receipt_jobs (user_id, status, total_count) VALUES ($1, 'pending', $2) RETURNING id`,
		userID, len(files),
	).Scan(&jobID); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	savedCount := 0
	var firstFilename, firstPath string
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
		filename := fmt.Sprintf("%s_%d%s", jobID[:8], time.Now().UnixNano(), ext)
		filePath := filepath.Join(uploadsDir, filename)
		if err := os.WriteFile(filePath, data, 0644); err != nil {
			continue
		}

		imagePath := "/" + filePath
		if _, err := h.db.Exec(context.Background(),
			`INSERT INTO receipt_results (job_id, user_id, status, filename, image_path)
			 VALUES ($1, $2, 'queued', $3, $4)`,
			jobID, userID, fh.Filename, imagePath,
		); err != nil {
			continue
		}

		if savedCount == 0 {
			firstFilename = fh.Filename
			firstPath = imagePath
		}
		savedCount++
	}

	if savedCount == 0 {
		h.db.Exec(context.Background(), `DELETE FROM receipt_jobs WHERE id=$1`, jobID)
		c.JSON(http.StatusBadRequest, gin.H{"error": "ไม่มีไฟล์ที่รองรับ (jpg, png, heic)"})
		return
	}

	h.db.Exec(context.Background(),
		`UPDATE receipt_jobs SET total_count=$1, filename=$2, image_path=$3 WHERE id=$4`,
		savedCount, firstFilename, firstPath, jobID,
	)

	go h.processReceiptJob(jobID, userID)

	c.JSON(http.StatusOK, gin.H{"job_id": jobID, "total": savedCount})
}

func (h *ReceiptHandler) GetJob(c *gin.Context) {
	jobID := c.Param("id")
	userID := c.GetString("user_id")

	job, err := h.fetchReceiptJob(jobID, userID)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "ไม่พบ job"})
		return
	}
	c.JSON(http.StatusOK, job)
}

func (h *ReceiptHandler) ListJobs(c *gin.Context) {
	userID := c.GetString("user_id")

	rows, err := h.db.Query(context.Background(),
		`SELECT id, status, total_count, done_count, error_msg, created_at::text
		 FROM receipt_jobs WHERE user_id=$1
		 ORDER BY created_at DESC LIMIT 10`,
		userID,
	)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	defer rows.Close()

	jobs := []ReceiptJobResp{}
	for rows.Next() {
		var j ReceiptJobResp
		if err := rows.Scan(&j.ID, &j.Status, &j.TotalCount, &j.DoneCount, &j.ErrorMsg, &j.CreatedAt); err == nil {
			jobs = append(jobs, j)
		}
	}
	c.JSON(http.StatusOK, jobs)
}

func (h *ReceiptHandler) CancelJob(c *gin.Context) {
	jobID := c.Param("id")
	userID := c.GetString("user_id")
	ctx := context.Background()

	tag, err := h.db.Exec(ctx,
		`UPDATE receipt_jobs
		 SET status='cancelled', updated_at=NOW()
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
		`UPDATE receipt_results
		 SET status='cancelled', updated_at=NOW()
		 WHERE job_id=$1 AND user_id=$2 AND status IN ('queued','ocr','parsing')`,
		jobID, userID,
	)
	c.JSON(http.StatusOK, gin.H{"status": "cancelled"})
}

func (h *ReceiptHandler) MarkResultSaved(c *gin.Context) {
	jobID := c.Param("id")
	resultID := c.Param("result_id")
	userID := c.GetString("user_id")

	tag, err := h.db.Exec(context.Background(),
		`UPDATE receipt_results
		 SET status='saved', updated_at=NOW()
		 WHERE id=$1 AND job_id=$2 AND user_id=$3 AND status='done'`,
		resultID, jobID, userID,
	)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	if tag.RowsAffected() == 0 {
		c.JSON(http.StatusNotFound, gin.H{"error": "ไม่พบผล OCR ที่บันทึกได้"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"status": "saved"})
}

func (h *ReceiptHandler) SkipResult(c *gin.Context) {
	jobID := c.Param("id")
	resultID := c.Param("result_id")
	userID := c.GetString("user_id")

	tag, err := h.db.Exec(context.Background(),
		`UPDATE receipt_results
		 SET status='skipped', updated_at=NOW()
		 WHERE id=$1 AND job_id=$2 AND user_id=$3 AND status IN ('done','rejected','error')`,
		resultID, jobID, userID,
	)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	if tag.RowsAffected() == 0 {
		c.JSON(http.StatusNotFound, gin.H{"error": "ไม่พบผล OCR ที่ข้ามได้"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"status": "skipped"})
}

func (h *ReceiptHandler) fetchReceiptJob(jobID, userID string) (*ReceiptJobResp, error) {
	var job ReceiptJobResp
	var resultJSON *string

	if err := h.db.QueryRow(context.Background(),
		`SELECT id, status, total_count, done_count, COALESCE(image_path,''), COALESCE(filename,''),
		        result_json, error_msg, created_at::text
		 FROM receipt_jobs WHERE id=$1 AND user_id=$2`,
		jobID, userID,
	).Scan(
		&job.ID, &job.Status, &job.TotalCount, &job.DoneCount, &job.ImagePath, &job.Filename,
		&resultJSON, &job.ErrorMsg, &job.CreatedAt,
	); err != nil {
		return nil, err
	}

	if resultJSON != nil && *resultJSON != "" {
		var d ReceiptData
		if json.Unmarshal([]byte(*resultJSON), &d) == nil {
			job.Data = &d
		}
	}

	rows, err := h.db.Query(context.Background(),
		`SELECT id, job_id, status, COALESCE(image_path,''), COALESCE(filename,''),
		        result_json, error_msg, created_at::text
		 FROM receipt_results WHERE job_id=$1 AND user_id=$2 ORDER BY created_at`,
		jobID, userID,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	job.Receipts = []ReceiptResultResp{}
	for rows.Next() {
		var r ReceiptResultResp
		var rJSON *string
		if err := rows.Scan(
			&r.ID, &r.JobID, &r.Status, &r.ImagePath, &r.Filename,
			&rJSON, &r.ErrorMsg, &r.CreatedAt,
		); err != nil {
			continue
		}
		if rJSON != nil && *rJSON != "" {
			var d ReceiptData
			if json.Unmarshal([]byte(*rJSON), &d) == nil {
				r.Data = &d
			}
		}
		job.Receipts = append(job.Receipts, r)
	}

	if len(job.Receipts) == 0 && job.Data != nil {
		job.Receipts = append(job.Receipts, ReceiptResultResp{
			ID:        job.ID,
			JobID:     job.ID,
			Status:    job.Status,
			ImagePath: job.ImagePath,
			Filename:  job.Filename,
			Data:      job.Data,
			ErrorMsg:  job.ErrorMsg,
			CreatedAt: job.CreatedAt,
		})
	}

	return &job, nil
}

func (h *ReceiptHandler) processReceiptJob(jobID, userID string) {
	ctx := context.Background()

	tag, err := h.db.Exec(ctx,
		`UPDATE receipt_jobs SET status='processing', updated_at=NOW()
		 WHERE id=$1 AND status <> 'cancelled'`,
		jobID,
	)
	if err != nil || tag.RowsAffected() == 0 {
		return
	}

	rows, err := h.db.Query(ctx,
		`SELECT id, image_path, filename FROM receipt_results
		 WHERE job_id=$1 AND user_id=$2 AND status='queued' ORDER BY created_at`,
		jobID, userID,
	)
	if err != nil {
		h.db.Exec(ctx, `UPDATE receipt_jobs SET status='error', error_msg=$2, updated_at=NOW() WHERE id=$1`,
			jobID, "อ่านคิวใบเสร็จไม่สำเร็จ")
		return
	}

	type receiptInfo struct{ id, imagePath, filename string }
	var receipts []receiptInfo
	for rows.Next() {
		var r receiptInfo
		if err := rows.Scan(&r.id, &r.imagePath, &r.filename); err == nil {
			receipts = append(receipts, r)
		}
	}
	rows.Close()

	for i, receipt := range receipts {
		if h.isReceiptJobCancelled(ctx, jobID) {
			return
		}
		if i > 0 {
			time.Sleep(3 * time.Second)
		}
		if h.isReceiptJobCancelled(ctx, jobID) {
			return
		}
		h.processOneReceipt(ctx, receipt.id, receipt.imagePath, receipt.filename)
	}

	if h.isReceiptJobCancelled(ctx, jobID) {
		return
	}
	h.db.Exec(ctx, `UPDATE receipt_jobs SET status='done', updated_at=NOW() WHERE id=$1`, jobID)
}

func (h *ReceiptHandler) processOneReceipt(ctx context.Context, receiptID, imagePath, filename string) {
	complete := func(status, msg string) {
		if msg != "" {
			h.db.Exec(ctx,
				`UPDATE receipt_results SET status=$1, error_msg=$2, updated_at=NOW() WHERE id=$3`,
				status, msg, receiptID,
			)
		} else {
			h.db.Exec(ctx,
				`UPDATE receipt_results SET status=$1, updated_at=NOW() WHERE id=$2`,
				status, receiptID,
			)
		}
		h.db.Exec(ctx,
			`UPDATE receipt_jobs SET done_count=done_count+1, updated_at=NOW()
			 WHERE id=(SELECT job_id FROM receipt_results WHERE id=$1)`, receiptID,
		)
	}
	fail := func(msg string) { complete("error", msg) }
	reject := func(msg string) { complete("rejected", msg) }
	isCancelled := func() bool {
		var cancelled bool
		_ = h.db.QueryRow(ctx,
			`SELECT EXISTS (
			 SELECT 1 FROM receipt_jobs j
			 JOIN receipt_results r ON r.job_id=j.id
			 WHERE r.id=$1 AND j.status='cancelled'
			)`, receiptID,
		).Scan(&cancelled)
		return cancelled
	}

	if isCancelled() {
		return
	}
	fullPath := strings.TrimPrefix(imagePath, "/")
	imageBytes, err := os.ReadFile(fullPath)
	if err != nil {
		fail(fmt.Sprintf("อ่านไฟล์ไม่ได้: %v", err))
		return
	}
	mimeType := imageMimeForExtension(filepath.Ext(fullPath))

	if isCancelled() {
		return
	}
	h.db.Exec(ctx, `UPDATE receipt_results SET status='ocr', updated_at=NOW() WHERE id=$1`, receiptID)
	ocrText, err := h.callReceiptOCR(imageBytes, mimeType)
	if err != nil {
		fail(fmt.Sprintf("OCR ล้มเหลว: %v", err))
		return
	}
	h.db.Exec(ctx, `UPDATE receipt_results SET ocr_text=$1, updated_at=NOW() WHERE id=$2`, ocrText, receiptID)

	if docType, confidence, err := h.callOCRDocumentClassifier(ocrText); err == nil && docType == ocrDocSlip && confidence >= 0.65 {
		reject("รูปนี้ดูเหมือนสลิปโอนเงิน กรุณาใช้เมนูสแกนสลิป")
		return
	}
	if classifyOCRDocument(ocrText) == ocrDocSlip {
		reject("รูปนี้ดูเหมือนสลิปโอนเงิน กรุณาใช้เมนูสแกนสลิป")
		return
	}

	if isCancelled() {
		return
	}
	h.db.Exec(ctx, `UPDATE receipt_results SET status='parsing', updated_at=NOW() WHERE id=$1`, receiptID)
	time.Sleep(2 * time.Second)

	parsed, err := h.callReceiptParser(ocrText)
	if err != nil {
		fail(fmt.Sprintf("แปลผลล้มเหลว: %v", err))
		return
	}
	if looksLikeSlipInReceiptFlow(ocrText, parsed) {
		reject("รูปนี้ดูเหมือนสลิปโอนเงิน กรุณาใช้เมนูสแกนสลิป")
		return
	}
	if looksInvalidReceipt(parsed) {
		reject("รูปนี้อ่านข้อมูลใบเสร็จไม่ครบ กรุณาใช้รูปที่เห็นวันที่ รายการ และราคาอย่างชัดเจน")
		return
	}

	resultBytes, _ := json.Marshal(parsed)
	h.db.Exec(ctx,
		`UPDATE receipt_results SET status='done', result_json=$1, updated_at=NOW() WHERE id=$2`,
		string(resultBytes), receiptID,
	)
	h.db.Exec(ctx,
		`UPDATE receipt_jobs
		 SET done_count=done_count+1,
		     result_json=COALESCE(result_json, $2),
		     updated_at=NOW()
		 WHERE id=(SELECT job_id FROM receipt_results WHERE id=$1)`,
		receiptID, string(resultBytes),
	)
}

func (h *ReceiptHandler) isReceiptJobCancelled(ctx context.Context, jobID string) bool {
	var status string
	if err := h.db.QueryRow(ctx, `SELECT status FROM receipt_jobs WHERE id=$1`, jobID).Scan(&status); err != nil {
		return true
	}
	return status == "cancelled"
}

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
		// G-Wallet / ถุงเงิน
		"g-wallet", "g wallet", "ถุงเงิน", "ทำรายการสำเร็จ", "จำนวนเงินที่ชำระ", "คนละครึ่ง",
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

func classifyOCRDocument(text string) ocrDocType {
	t := strings.ToLower(text)
	if hasStrongSlipEvidence(text) {
		return ocrDocSlip
	}

	slipKeywords := []string{
		"promptpay", "พร้อมเพย์", "transfer", "โอนเงิน", "โอนสำเร็จ", "ชำระเงินสำเร็จ", "สลิป",
		"sender", "receiver", "from account", "to account", "account no",
		"k+", "เลขที่รายการ", "ค่าธรรมเนียม", "สแกนตรวจสอบสลิป",
		"จากบัญชี", "ไปยังบัญชี", "ผู้โอน", "ผู้รับ", "ผู้รับเงิน",
		"ธนาคาร", "kbank", "scb", "krungthai", "ktb", "bangkok bank", "bbl",
		"kasikorn", "กสิกร", "ไทยพาณิชย์", "กรุงไทย", "กรุงเทพ", "กรุงศรี", "ออมสิน",
		// G-Wallet / ถุงเงิน (คนละครึ่ง, ดิจิทัลวอลเล็ต)
		"g-wallet", "g wallet", "ถุงเงิน", "ทำรายการสำเร็จ", "รหัสอ้างอิง",
		"คนละครึ่ง", "จำนวนเงินที่ชำระ", "ค่าสินค้า/บริการ",
	}
	receiptKeywords := []string{
		"receipt", "tax invoice", "invoice", "vat", "subtotal", "total", "cash", "change",
		"qty", "quantity", "cashier", "ใบเสร็จ", "ใบกำกับภาษี", "ภาษีมูลค่าเพิ่ม",
		"รวมทั้งสิ้น", "ยอดรวม", "เงินทอน", "ส่วนลด", "จำนวน", "ราคา", "แคชเชียร์",
		"สาขา", "เลขประจำตัวผู้เสียภาษี",
	}

	slipScore := 0
	for _, keyword := range slipKeywords {
		if strings.Contains(t, strings.ToLower(keyword)) {
			slipScore++
		}
	}

	receiptScore := 0
	for _, keyword := range receiptKeywords {
		if strings.Contains(t, strings.ToLower(keyword)) {
			receiptScore++
		}
	}

	if slipScore >= 2 && slipScore > receiptScore {
		return ocrDocSlip
	}
	if receiptScore >= 2 && receiptScore >= slipScore {
		return ocrDocReceipt
	}
	return ocrDocUnknown
}

func hasStrongSlipEvidence(text string) bool {
	t := strings.ToLower(text)
	hasPromptPayTransferContext := (strings.Contains(t, "promptpay") || strings.Contains(t, "พร้อมเพย์")) &&
		(strings.Contains(t, "ผู้โอน") ||
			strings.Contains(t, "ผู้รับ") ||
			strings.Contains(t, "ผู้รับเงิน") ||
			strings.Contains(t, "จากบัญชี") ||
			strings.Contains(t, "ไปยังบัญชี") ||
			strings.Contains(t, "เลขที่รายการ"))

	// G-Wallet / ถุงเงิน slip: มี "ทำรายการสำเร็จ" + "รหัสอ้างอิง" (UUID ยาว) หรือ G-Wallet ID
	hasGWalletSlipContext := (strings.Contains(t, "ทำรายการสำเร็จ") || strings.Contains(t, "g-wallet") || strings.Contains(t, "ถุงเงิน")) &&
		(strings.Contains(t, "รหัสอ้างอิง") || strings.Contains(t, "จำนวนเงินที่ชำระ"))

	return strings.Contains(t, "ชำระเงินสำเร็จ") ||
		strings.Contains(t, "โอนสำเร็จ") ||
		strings.Contains(t, "ทำรายการสำเร็จ") ||
		strings.Contains(t, "สแกนตรวจสอบสลิป") ||
		strings.Contains(t, "เลขที่รายการ") ||
		strings.Contains(t, "ค่าธรรมเนียม") ||
		strings.Contains(t, "k+") ||
		hasPromptPayTransferContext ||
		hasGWalletSlipContext
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

กฎสำคัญ:
- Ref No, reference, transaction id เพียงอย่างเดียวไม่พอให้เป็น slip เพราะใบเสร็จก็มีได้
- ถ้ามีโครงสร้างผู้โอน/ผู้รับ/บัญชี/ธนาคาร/PromptPay/ยอดโอน ให้จัดเป็น slip
- ถ้ามีรายการสินค้า/บริการหลายรายการพร้อมราคา ร้านค้า หรือภาษี ให้จัดเป็น receipt
- ถ้ามีทั้งสองแบบ ให้เลือกชนิดที่เป็นเอกสารหลักจากบริบททั้งหมด
- "ทำรายการสำเร็จ" + "รหัสอ้างอิง" + G-Wallet ID → slip เสมอ แม้จะมี "ค่าสินค้า/บริการ" หรือ "สิทธิคนละครึ่ง" ปรากฏอยู่ด้วย
- ถ้ามี sender→receiver structure (มีลูกศร ↓ หรือมีชื่อผู้โอนและผู้รับ) → slip
- confidence ต้องอยู่ระหว่าง 0 และ 1`

func (h *ReceiptHandler) callOCRDocumentClassifier(ocrText string) (ocrDocType, float64, error) {
	if err := waitTyphoonLLM(context.Background()); err != nil {
		return ocrDocUnknown, 0, err
	}

	payload := llmChatReq{
		Model: h.cfg.Typhoon.ExtractModel,
		Messages: []llmChatMsg{
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

	var llmResp llmChatResp
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

func (h *ReceiptHandler) callReceiptOCR(imageBytes []byte, mimeType string) (string, error) {
	if err := waitTyphoonOCR(context.Background()); err != nil {
		return "", err
	}

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
	w.WriteField("task_type", "Read all text from this receipt or bill document exactly as it appears. Preserve dates, store names, item names, item prices, VAT, discounts, and totals accurately.")
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
	return "", fmt.Errorf("OCR ไม่ได้ข้อความกลับมา")
}

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

func (h *ReceiptHandler) callReceiptParser(ocrText string) (*ReceiptData, error) {
	if err := waitTyphoonLLM(context.Background()); err != nil {
		return nil, err
	}

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
	sanitizeReceiptData(&result)
	if result.VAT != nil && result.VAT.Amount <= 0 {
		result.VAT = nil
	}
	if result.Discount != nil && result.Discount.Amount <= 0 {
		result.Discount = nil
	}
	return &result, nil
}
