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

// Status constants
const (
	jobPending    = "pending"
	jobProcessing = "processing"
	jobDone       = "done"
	jobError      = "error"

	slipQueued  = "queued"
	slipOCR     = "ocr"
	slipParsing = "parsing"
	slipDone    = "done"
	slipError   = "error"
)

// Response structs
type SlipResult struct {
	ID              string  `json:"id"`
	JobID           string  `json:"job_id"`
	Status          string  `json:"status"`
	Filename        string  `json:"filename"`
	ImagePath       string  `json:"image_path"`
	Bank            *string `json:"bank"`
	Amount          float64 `json:"amount"`
	TransactionDate *string `json:"transaction_date"`
	TransactionTime *string `json:"transaction_time"`
	Sender          *string `json:"sender"`
	Receiver        *string `json:"receiver"`
	RefNo           *string `json:"ref_no"`
	IsDuplicate     bool    `json:"is_duplicate"`
	ErrorMsg        *string `json:"error_msg"`
	CreatedAt       string  `json:"created_at"`
}

type SlipJob struct {
	ID         string       `json:"id"`
	Status     string       `json:"status"`
	TotalCount int          `json:"total_count"`
	DoneCount  int          `json:"done_count"`
	CreatedAt  string       `json:"created_at"`
	Slips      []SlipResult `json:"slips"`
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

// Handler
type SlipHandler struct {
	db  *pgxpool.Pool
	cfg *config.Config
}

func NewSlipHandler(db *pgxpool.Pool, cfg *config.Config) *SlipHandler {
	return &SlipHandler{db: db, cfg: cfg}
}

// ─── POST /api/v1/slip-jobs ───────────────────────────────────────────────────
// รับ multipart "files" (สูงสุด 5 ไฟล์) → สร้าง job → background processing
func (h *SlipHandler) CreateJob(c *gin.Context) {
	userID := c.GetString("user_id")

	if err := c.Request.ParseMultipartForm(50 << 20); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "ต้องส่งไฟล์แบบ multipart"})
		return
	}
	files := c.Request.MultipartForm.File["files"]
	if len(files) == 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "ไม่พบไฟล์ (field: files)"})
		return
	}
	if len(files) > 5 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "อัปโหลดได้สูงสุด 5 ไฟล์ต่อครั้ง"})
		return
	}

	// สร้าง folder สำหรับเก็บรูป
	uploadsDir := "uploads/slips"
	os.MkdirAll(uploadsDir, 0755)

	// สร้าง job
	var jobID string
	if err := h.db.QueryRow(context.Background(),
		`INSERT INTO slip_jobs (user_id, status, total_count) VALUES ($1, 'pending', $2) RETURNING id`,
		userID, len(files),
	).Scan(&jobID); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	// บันทึกไฟล์แต่ละใบ + สร้าง slip_result
	savedCount := 0
	for _, fh := range files {
		mimeType := fh.Header.Get("Content-Type")
		allowed := map[string]bool{
			"image/jpeg": true, "image/jpg": true,
			"image/png": true, "image/heic": true, "image/heif": true,
		}
		if !allowed[mimeType] {
			continue
		}

		f, err := fh.Open()
		if err != nil {
			continue
		}
		data, _ := io.ReadAll(f)
		f.Close()

		// แปลง HEIC → JPEG ถ้าจำเป็น
		if mimeType == "image/heic" || mimeType == "image/heif" {
			converted, err := convertHEIC(data)
			if err == nil {
				data = converted
				mimeType = "image/jpeg"
			}
			// ถ้า convert ไม่ได้ก็ส่งต่อ OCR แบบเดิม
		}

		// บันทึกไฟล์
		ext := ".jpg"
		if mimeType == "image/png" {
			ext = ".png"
		}
		filename := fmt.Sprintf("%s_%d%s", jobID[:8], time.Now().UnixNano(), ext)
		filePath := filepath.Join(uploadsDir, filename)
		if err := os.WriteFile(filePath, data, 0644); err != nil {
			continue
		}

		// สร้าง slip_result
		h.db.Exec(context.Background(),
			`INSERT INTO slip_results (job_id, user_id, status, filename, image_path)
			 VALUES ($1, $2, 'queued', $3, $4)`,
			jobID, userID, fh.Filename, "/"+filePath,
		)
		savedCount++
	}

	if savedCount == 0 {
		h.db.Exec(context.Background(), `DELETE FROM slip_jobs WHERE id=$1`, jobID)
		c.JSON(http.StatusBadRequest, gin.H{"error": "ไม่มีไฟล์ที่รองรับ (jpg, png, heic)"})
		return
	}

	// อัปเดต total_count ตามจำนวนจริง
	h.db.Exec(context.Background(),
		`UPDATE slip_jobs SET total_count=$1 WHERE id=$2`, savedCount, jobID,
	)

	// เริ่ม background processing
	go h.processJob(jobID, userID)

	c.JSON(http.StatusOK, gin.H{
		"job_id": jobID,
		"total":  savedCount,
	})
}

// ─── GET /api/v1/slip-jobs/:id ────────────────────────────────────────────────
func (h *SlipHandler) GetJob(c *gin.Context) {
	jobID := c.Param("id")
	userID := c.GetString("user_id")

	var job SlipJob
	if err := h.db.QueryRow(context.Background(),
		`SELECT id, status, total_count, done_count, created_at::text
		 FROM slip_jobs WHERE id=$1 AND user_id=$2`,
		jobID, userID,
	).Scan(&job.ID, &job.Status, &job.TotalCount, &job.DoneCount, &job.CreatedAt); err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "ไม่พบ job"})
		return
	}

	rows, err := h.db.Query(context.Background(),
		`SELECT id, job_id, status, COALESCE(filename,''), COALESCE(image_path,''),
		        bank, amount, transaction_date::text, transaction_time,
		        sender, receiver, ref_no, is_duplicate, error_msg, created_at::text
		 FROM slip_results WHERE job_id=$1 ORDER BY created_at`,
		jobID,
	)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	defer rows.Close()

	job.Slips = []SlipResult{}
	for rows.Next() {
		var s SlipResult
		rows.Scan(
			&s.ID, &s.JobID, &s.Status, &s.Filename, &s.ImagePath,
			&s.Bank, &s.Amount, &s.TransactionDate, &s.TransactionTime,
			&s.Sender, &s.Receiver, &s.RefNo, &s.IsDuplicate, &s.ErrorMsg, &s.CreatedAt,
		)
		job.Slips = append(job.Slips, s)
	}

	c.JSON(http.StatusOK, job)
}

// ─── GET /api/v1/slip-jobs ────────────────────────────────────────────────────
// ดึงรายการ jobs ล่าสุด 10 รายการของ user
func (h *SlipHandler) ListJobs(c *gin.Context) {
	userID := c.GetString("user_id")

	rows, err := h.db.Query(context.Background(),
		`SELECT id, status, total_count, done_count, created_at::text
		 FROM slip_jobs WHERE user_id=$1
		 ORDER BY created_at DESC LIMIT 10`,
		userID,
	)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	defer rows.Close()

	jobs := []SlipJob{}
	for rows.Next() {
		var j SlipJob
		rows.Scan(&j.ID, &j.Status, &j.TotalCount, &j.DoneCount, &j.CreatedAt)
		jobs = append(jobs, j)
	}
	c.JSON(http.StatusOK, jobs)
}

// ─── POST /api/v1/slip-jobs/:job_id/results/:result_id/save ──────────────────
// User ยืนยันข้อมูล → สร้าง transaction
func (h *SlipHandler) SaveResult(c *gin.Context) {
	userID := c.GetString("user_id")
	resultID := c.Param("result_id")

	var body struct {
		AccountID       string  `json:"account_id"`
		CategoryID      string  `json:"category_id"`
		TxType          string  `json:"tx_type"` // "income" | "expense"
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

	// กำหนด type (income / expense)
	txType := "income"
	if body.TxType == "expense" {
		txType = "expense"
	}

	// ตรวจ ref_no ซ้ำ
	if body.RefNo != "" {
		var cnt int
		h.db.QueryRow(context.Background(),
			`SELECT COUNT(*) FROM slip_ref_log WHERE user_id=$1 AND ref_no=$2`,
			userID, body.RefNo,
		).Scan(&cnt)
		if cnt > 0 {
			c.JSON(http.StatusConflict, gin.H{"error": "Ref No. นี้ถูกบันทึกแล้ว (สลิปซ้ำ)"})
			return
		}
	}

	// สร้าง transaction
	catID := nilUUID(body.CategoryID)
	txDate := body.TransactionDate
	if txDate == "" {
		txDate = time.Now().Format("2006-01-02")
	}
	txName := nilStr(body.Name)

	var txID string
	err := h.db.QueryRow(context.Background(),
		`INSERT INTO transactions
		 (user_id, account_id, category_id, type, amount, name, note, transaction_date, image_path)
		 VALUES ($1, $2, $3, $4, $5, $6, $7, $8::date, $9)
		 RETURNING id`,
		userID, body.AccountID, catID, txType, body.Amount,
		txName, body.Note, txDate, nilStr(body.ImagePath),
	).Scan(&txID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	// อัปเดต balance บัญชี (income = เพิ่ม, expense = ลด)
	if txType == "income" {
		h.db.Exec(context.Background(),
			`UPDATE accounts SET balance = balance + $1, updated_at = NOW() WHERE id = $2`,
			body.Amount, body.AccountID,
		)
	} else {
		h.db.Exec(context.Background(),
			`UPDATE accounts SET balance = balance - $1, updated_at = NOW() WHERE id = $2`,
			body.Amount, body.AccountID,
		)
	}

	// บันทึก ref_no เพื่อตรวจซ้ำครั้งต่อไป
	if body.RefNo != "" {
		h.db.Exec(context.Background(),
			`INSERT INTO slip_ref_log (user_id, ref_no, transaction_id)
			 VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
			userID, body.RefNo, txID,
		)
	}

	// อัปเดต slip_result ว่าถูก save แล้ว
	h.db.Exec(context.Background(),
		`UPDATE slip_results SET status='saved', updated_at=NOW() WHERE id=$1`, resultID,
	)

	c.JSON(http.StatusOK, gin.H{"transaction_id": txID})
}

// ─── Background worker ────────────────────────────────────────────────────────
func (h *SlipHandler) processJob(jobID, userID string) {
	ctx := context.Background()

	h.db.Exec(ctx,
		`UPDATE slip_jobs SET status='processing', updated_at=NOW() WHERE id=$1`, jobID,
	)

	// ดึง slip ที่รอคิว
	rows, err := h.db.Query(ctx,
		`SELECT id, image_path, filename FROM slip_results
		 WHERE job_id=$1 AND status='queued' ORDER BY created_at`,
		jobID,
	)
	if err != nil {
		h.db.Exec(ctx, `UPDATE slip_jobs SET status='error', updated_at=NOW() WHERE id=$1`, jobID)
		return
	}

	type slipInfo struct{ id, imagePath, filename string }
	var slips []slipInfo
	for rows.Next() {
		var s slipInfo
		rows.Scan(&s.id, &s.imagePath, &s.filename)
		slips = append(slips, s)
	}
	rows.Close()

	for i, slip := range slips {
		// Rate limit: 2 req/s → รอ 3 วินาทีระหว่างแต่ละใบ (OCR + Parse = 2 calls)
		if i > 0 {
			time.Sleep(3 * time.Second)
		}
		h.processOneSlip(ctx, slip.id, slip.imagePath, slip.filename, userID)
	}

	// อัปเดต job เป็น done
	h.db.Exec(ctx,
		`UPDATE slip_jobs SET status='done', updated_at=NOW() WHERE id=$1`, jobID,
	)
}

func (h *SlipHandler) processOneSlip(ctx context.Context, slipID, imagePath, filename, userID string) {
	fail := func(msg string) {
		h.db.Exec(ctx,
			`UPDATE slip_results SET status='error', error_msg=$1, updated_at=NOW() WHERE id=$2`,
			msg, slipID,
		)
		h.db.Exec(ctx,
			`UPDATE slip_jobs SET done_count=done_count+1, updated_at=NOW()
			 WHERE id=(SELECT job_id FROM slip_results WHERE id=$1)`, slipID,
		)
	}

	// ── Step 1: อ่านไฟล์ ─────────────────────────────────────────────────────
	fullPath := strings.TrimPrefix(imagePath, "/")
	imageBytes, err := os.ReadFile(fullPath)
	if err != nil {
		fail(fmt.Sprintf("อ่านไฟล์ไม่ได้: %v", err))
		return
	}

	mimeType := "image/jpeg"
	switch strings.ToLower(filepath.Ext(filename)) {
	case ".png":
		mimeType = "image/png"
	case ".heic", ".heif":
		mimeType = "image/heic"
	}

	// ── Step 2: OCR ──────────────────────────────────────────────────────────
	h.db.Exec(ctx,
		`UPDATE slip_results SET status='ocr', updated_at=NOW() WHERE id=$1`, slipID,
	)

	ocrText, err := h.callTyphoonOCR(imageBytes, mimeType)
	if err != nil {
		fail(fmt.Sprintf("OCR ล้มเหลว: %v", err))
		return
	}
	h.db.Exec(ctx,
		`UPDATE slip_results SET ocr_text=$1, updated_at=NOW() WHERE id=$2`, ocrText, slipID,
	)

	// ── Step 3: Parse ─────────────────────────────────────────────────────────
	h.db.Exec(ctx,
		`UPDATE slip_results SET status='parsing', updated_at=NOW() WHERE id=$1`, slipID,
	)
	time.Sleep(2 * time.Second) // rate limit buffer

	parsed, err := h.callTyphoonParser(ocrText)
	if err != nil {
		fail(fmt.Sprintf("Parser ล้มเหลว: %v", err))
		return
	}

	// ── Step 4: ตรวจสลิปซ้ำ ──────────────────────────────────────────────────
	isDuplicate := false
	if parsed.RefNo != nil && *parsed.RefNo != "" {
		var cnt int
		h.db.QueryRow(ctx,
			`SELECT COUNT(*) FROM slip_ref_log WHERE user_id=$1 AND ref_no=$2`,
			userID, *parsed.RefNo,
		).Scan(&cnt)
		isDuplicate = cnt > 0
	}

	// ── Step 5: บันทึกผลลัพธ์ ─────────────────────────────────────────────────
	h.db.Exec(ctx,
		`UPDATE slip_results SET
		    status='done', bank=$1, amount=$2, transaction_date=$3::date,
		    transaction_time=$4, sender=$5, receiver=$6, ref_no=$7,
		    is_duplicate=$8, updated_at=NOW()
		 WHERE id=$9`,
		parsed.Bank, parsed.Amount, parsed.Date, parsed.Time,
		parsed.Sender, parsed.Receiver, parsed.RefNo,
		isDuplicate, slipID,
	)

	// เพิ่ม done_count
	h.db.Exec(ctx,
		`UPDATE slip_jobs SET done_count=done_count+1, updated_at=NOW()
		 WHERE id=(SELECT job_id FROM slip_results WHERE id=$1)`, slipID,
	)
}

// ─── Typhoon OCR ──────────────────────────────────────────────────────────────
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

func (h *SlipHandler) callTyphoonOCR(imageBytes []byte, mimeType string) (string, error) {
	var buf bytes.Buffer
	w := multipart.NewWriter(&buf)

	// แนบไฟล์รูป
	ext := "jpg"
	if mimeType == "image/png" {
		ext = "png"
	}
	mh := make(textproto.MIMEHeader)
	mh.Set("Content-Disposition", fmt.Sprintf(`form-data; name="file"; filename="slip.%s"`, ext))
	mh.Set("Content-Type", mimeType)
	part, err := w.CreatePart(mh)
	if err != nil {
		return "", err
	}
	part.Write(imageBytes)

	w.WriteField("model", "typhoon-ocr")
	w.WriteField("task_type", "Read all text from this bank slip document exactly as it appears. Preserve numbers, names, dates, and reference codes accurately.")
	w.WriteField("max_tokens", "1500")
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

// ─── Typhoon LLM Parser ───────────────────────────────────────────────────────
var slipParserPrompt = `คุณคือผู้ช่วยดึงข้อมูลจากข้อความ OCR ของสลิปธนาคารไทย
ตอบเป็น JSON เท่านั้น ห้ามมีข้อความหรือ markdown อื่น
รูปแบบ:
{
  "bank": "ชื่อธนาคาร เช่น กสิกรไทย ไทยพาณิชย์ กรุงเทพ กรุงไทย ออมสิน กรุงศรี ทีทีบี ธ.ก.ส. UOB",
  "amount": 0.00,
  "date": "YYYY-MM-DD",
  "time": "HH:MM",
  "sender": "ชื่อผู้โอน (เฉพาะชื่อ ไม่รวมเลขบัญชี)",
  "receiver": "ชื่อผู้รับ (เฉพาะชื่อ ไม่รวมเลขบัญชี)",
  "ref_no": "รหัสอ้างอิง หรือเลขที่รายการ"
}
กฎ:
- ตอบ JSON เท่านั้น ไม่มี markdown
- ถ้าหาไม่เจอให้ใส่ null
- date: แปลงเป็น YYYY-MM-DD (วันที่ พ.ศ. ให้ลบ 543 ก่อน)
- amount: เป็น float ไม่มี comma เช่น 1500.00
- ref_no: ให้เลือก Transaction reference หรือ เลขที่รายการที่ยาวที่สุด`

type llmChatReq struct {
	Model       string       `json:"model"`
	Messages    []llmChatMsg `json:"messages"`
	MaxTokens   int          `json:"max_tokens"`
	Temperature float64      `json:"temperature"`
	TopP        float64      `json:"top_p"`
}

type llmChatMsg struct {
	Role    string `json:"role"`
	Content string `json:"content"`
}

type llmChatResp struct {
	Choices []struct {
		Message struct {
			Content string `json:"content"`
		} `json:"message"`
	} `json:"choices"`
}

func (h *SlipHandler) callTyphoonParser(ocrText string) (*SlipData, error) {
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
	// ลบ markdown code block ถ้ามี
	content = strings.TrimPrefix(content, "```json")
	content = strings.TrimPrefix(content, "```")
	content = strings.TrimSuffix(content, "```")
	content = strings.TrimSpace(content)

	var result SlipData
	if err := json.Unmarshal([]byte(content), &result); err != nil {
		return nil, fmt.Errorf("parse JSON ไม่ได้: %v | content: %s", err, content)
	}
	return &result, nil
}

// ─── HEIC → JPEG (ตรวจจับ + แจ้งเตือน) ─────────────────────────────────────
// TODO: เพิ่ม go get github.com/adrium/goheif เพื่อ convert HEIC จริง
func convertHEIC(data []byte) ([]byte, error) {
	// ตรวจ magic bytes: HEIC มี "ftyp" ที่ offset 4
	if len(data) < 12 || string(data[4:8]) != "ftyp" {
		return nil, fmt.Errorf("ไม่ใช่ HEIC")
	}
	// Placeholder: คืนค่า error เพื่อให้ส่งต่อ OCR ไปเลย
	// (Typhoon OCR รองรับบางรูปแบบ HEIC ได้)
	return nil, fmt.Errorf("HEIC conversion ยังไม่รองรับ")
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
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
