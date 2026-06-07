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

	"paomoney/internal/config"

	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5/pgxpool"
)

const (
	scanDocReceipt = "receipt"
	scanDocSlip    = "slip"
	scanDocUnknown = "unknown"
)

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
	db  *pgxpool.Pool
	cfg *config.Config
}

func NewScanHandler(db *pgxpool.Pool, cfg *config.Config) *ScanHandler {
	h := &ScanHandler{db: db, cfg: cfg}
	_ = h.ensureSchema(context.Background())
	return h
}

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

	uploadsDir := "uploads/scans"
	_ = os.MkdirAll(uploadsDir, 0755)

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
		filename := fmt.Sprintf("%s_%d%s", jobID[:8], time.Now().UnixNano(), ext)
		filePath := filepath.Join(uploadsDir, filename)
		if err := os.WriteFile(filePath, data, 0644); err != nil {
			continue
		}

		if _, err := h.db.Exec(context.Background(),
			`INSERT INTO scan_results (job_id, user_id, status, filename, image_path)
			 VALUES ($1, $2, 'queued', $3, $4)`,
			jobID, userID, fh.Filename, "/"+filePath,
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

	fullPath := strings.TrimPrefix(imagePath, "/")
	imageBytes, err := os.ReadFile(fullPath)
	if err != nil {
		fail(fmt.Sprintf("อ่านไฟล์ไม่ได้: %v", err))
		return
	}
	mimeType := imageMimeForExtension(filepath.Ext(fullPath))

	h.db.Exec(ctx, `UPDATE scan_results SET status='ocr', updated_at=NOW() WHERE id=$1`, resultID)
	ocrText, err := h.callFinancialOCR(imageBytes, mimeType)
	if err != nil {
		fail(fmt.Sprintf("อ่านรูปไม่สำเร็จ: %v", err))
		return
	}
	h.db.Exec(ctx, `UPDATE scan_results SET ocr_text=$1, updated_at=NOW() WHERE id=$2`, ocrText, resultID)

	docType := classifyOCRDocument(ocrText)
	if hasStrongSlipEvidence(ocrText) {
		docType = ocrDocSlip
	} else if classified, confidence, err := h.callOCRDocumentClassifier(ocrText); err == nil && confidence >= 0.6 {
		docType = classified
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

func (h *ScanHandler) callFinancialOCR(imageBytes []byte, mimeType string) (string, error) {
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

func (h *ScanHandler) callReceiptParser(ocrText string) (*ReceiptData, error) {
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

func (h *ScanHandler) callTyphoonParser(ocrText string) (*SlipData, error) {
	if err := waitTyphoonLLM(context.Background()); err != nil {
		return nil, err
	}

	payload := llmChatReq{
		Model: h.cfg.Typhoon.ExtractModel,
		Messages: []llmChatMsg{
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

	var result SlipData
	if err := json.Unmarshal([]byte(content), &result); err != nil {
		return nil, fmt.Errorf("parse JSON ไม่ได้: %v | content: %s", err, content)
	}
	normalizeSlipOCRDate(&result, ocrText)
	return &result, nil
}
