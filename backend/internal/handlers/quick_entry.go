package handlers

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"math"
	"net/http"
	"regexp"
	"strconv"
	"strings"
	"time"

	"paomoney/internal/config"

	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

type QuickEntryHandler struct {
	db  *pgxpool.Pool
	cfg *config.Config
}

func NewQuickEntryHandler(db *pgxpool.Pool, cfg *config.Config) *QuickEntryHandler {
	if err := ensureQuickEntryChatLogsTable(db); err != nil {
		log.Printf("failed to ensure quick_entry_chat_logs table: %v", err)
	}
	return &QuickEntryHandler{db: db, cfg: cfg}
}

type quickEntryParseRequest struct {
	Mode string `json:"mode" binding:"required,oneof=income expense saving"`
	Text string `json:"text" binding:"required"`
}

var (
	quickEntryAmountRe       = regexp.MustCompile(`[-+]?\d+(?:[,.]\d+)?`)
	quickEntryNegativeAmount = regexp.MustCompile(`(^|[^\d])-\s*\d+(?:[,.]\d+)?`)
	quickEntryMeaningfulText = regexp.MustCompile(`\p{L}`)
)

type quickEntryParseResponse struct {
	Mode         string  `json:"mode"`
	Title        string  `json:"title"`
	Amount       float64 `json:"amount"`
	CategoryID   *string `json:"category_id,omitempty"`
	CategoryName *string `json:"category_name,omitempty"`
	Confidence   float64 `json:"confidence"`
	NeedsReview  bool    `json:"needs_review"`
}

type quickEntryChatLogRequest struct {
	Mode     string          `json:"mode" binding:"required"`
	Messages json.RawMessage `json:"messages" binding:"required"`
}

type quickEntryChatLogResponse struct {
	Mode     string          `json:"mode"`
	Messages json.RawMessage `json:"messages"`
}

type quickEntryCategory struct {
	ID   string `json:"id"`
	Name string `json:"name"`
}

type quickEntryLLMResult struct {
	Title        string  `json:"title"`
	Amount       float64 `json:"amount"`
	CategoryName *string `json:"category_name"`
	Confidence   float64 `json:"confidence"`
}

func ensureQuickEntryChatLogsTable(db *pgxpool.Pool) error {
	ctx := context.Background()
	_, err := db.Exec(ctx, `
		CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
		CREATE TABLE IF NOT EXISTS quick_entry_chat_logs (
			id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
			user_id    UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
			mode       VARCHAR(20) NOT NULL CHECK (mode IN ('income', 'expense', 'saving', 'chat')),
			messages   JSONB       NOT NULL DEFAULT '[]'::jsonb,
			created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
			updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
			UNIQUE (user_id, mode)
		);
		ALTER TABLE quick_entry_chat_logs DROP CONSTRAINT IF EXISTS quick_entry_chat_logs_mode_check;
		ALTER TABLE quick_entry_chat_logs
			ADD CONSTRAINT quick_entry_chat_logs_mode_check
			CHECK (mode IN ('income', 'expense', 'saving', 'chat'));
		CREATE INDEX IF NOT EXISTS idx_quick_entry_chat_logs_user ON quick_entry_chat_logs(user_id, mode);
	`)
	return err
}

func validQuickEntryMode(mode string) bool {
	return mode == "income" || mode == "expense" || mode == "saving" || mode == "chat"
}

func normalizeQuickEntryMessages(raw json.RawMessage) (json.RawMessage, error) {
	var messages []map[string]interface{}
	if err := json.Unmarshal(raw, &messages); err != nil {
		return nil, err
	}
	if len(messages) > 80 {
		messages = messages[len(messages)-80:]
	}
	return json.Marshal(messages)
}

func (h *QuickEntryHandler) GetChatLog(c *gin.Context) {
	userID := c.GetString("user_id")
	mode := strings.TrimSpace(c.Query("mode"))
	if !validQuickEntryMode(mode) {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid mode"})
		return
	}

	var messages json.RawMessage
	err := h.db.QueryRow(context.Background(),
		`SELECT messages FROM quick_entry_chat_logs WHERE user_id=$1 AND mode=$2`,
		userID, mode,
	).Scan(&messages)
	if err != nil {
		if err == pgx.ErrNoRows {
			c.JSON(http.StatusOK, quickEntryChatLogResponse{Mode: mode, Messages: json.RawMessage("[]")})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": "โหลดประวัติแชทไม่สำเร็จ"})
		return
	}
	if len(messages) == 0 {
		messages = json.RawMessage("[]")
	}
	c.JSON(http.StatusOK, quickEntryChatLogResponse{Mode: mode, Messages: messages})
}

func (h *QuickEntryHandler) SaveChatLog(c *gin.Context) {
	userID := c.GetString("user_id")
	var req quickEntryChatLogRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	messages, err := normalizeQuickEntryMessages(req.Messages)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "messages ต้องเป็น JSON array"})
		return
	}

	_, err = h.db.Exec(context.Background(),
		`INSERT INTO quick_entry_chat_logs (user_id, mode, messages)
		 VALUES ($1, $2, $3::jsonb)
		 ON CONFLICT (user_id, mode)
		 DO UPDATE SET messages = EXCLUDED.messages, updated_at = CURRENT_TIMESTAMP`,
		userID, req.Mode, string(messages),
	)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "บันทึกประวัติแชทไม่สำเร็จ"})
		return
	}
	c.JSON(http.StatusOK, quickEntryChatLogResponse{Mode: req.Mode, Messages: messages})
}

func (h *QuickEntryHandler) ClearChatLog(c *gin.Context) {
	userID := c.GetString("user_id")
	mode := strings.TrimSpace(c.Query("mode"))
	if !validQuickEntryMode(mode) {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid mode"})
		return
	}
	_, err := h.db.Exec(context.Background(),
		`DELETE FROM quick_entry_chat_logs WHERE user_id=$1 AND mode=$2`,
		userID, mode,
	)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "ล้างประวัติแชทไม่สำเร็จ"})
		return
	}
	c.JSON(http.StatusOK, quickEntryChatLogResponse{Mode: mode, Messages: json.RawMessage("[]")})
}

func validateQuickEntryInput(mode, text string) string {
	text = strings.TrimSpace(text)
	if quickEntryNegativeAmount.MatchString(text) {
		return "จำนวนเงินต้องมากกว่า 0 บาทครับ กรุณาใส่จำนวนเงินเป็นค่าบวก เช่น \"กาแฟ 50\""
	}

	matches := quickEntryAmountRe.FindAllStringIndex(text, -1)
	if len(matches) == 0 {
		return "ยังไม่พบจำนวนเงินครับ ลองพิมพ์ชื่อรายการพร้อมจำนวนเงิน เช่น \"กาแฟ 50\""
	}

	last := matches[len(matches)-1]
	amountText := text[last[0]:last[1]]
	amount, err := strconv.ParseFloat(strings.ReplaceAll(amountText, ",", ""), 64)
	if err != nil || amount <= 0 {
		return "จำนวนเงินต้องมากกว่า 0 บาทครับ กรุณาใส่จำนวนเงินเป็นค่าบวก เช่น \"กาแฟ 50\""
	}

	titleText := strings.TrimSpace(text[:last[0]] + " " + text[last[1]:])
	titleText = strings.TrimSpace(strings.ReplaceAll(titleText, "บาท", ""))
	if mode != "saving" {
		for _, word := range []string{"รายรับ", "รายจ่าย", "จ่าย", "รับ"} {
			titleText = strings.TrimSpace(strings.TrimPrefix(titleText, word))
		}
	}
	if !quickEntryMeaningfulText.MatchString(titleText) {
		return "ยังไม่พบชื่อรายการครับ ลองพิมพ์เป็น \"กาแฟ 50\" หรือ \"เงินเดือน 30000\""
	}

	return ""
}

func (h *QuickEntryHandler) Parse(c *gin.Context) {
	userID := c.GetString("user_id")

	var req quickEntryParseRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	req.Text = strings.TrimSpace(req.Text)
	if req.Text == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "กรุณาพิมพ์รายการที่ต้องการบันทึก"})
		return
	}

	if validationError := validateQuickEntryInput(req.Mode, req.Text); validationError != "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": validationError})
		return
	}

	categories := []quickEntryCategory{}
	if req.Mode == "income" || req.Mode == "expense" {
		var err error
		categories, err = h.listQuickEntryCategories(context.Background(), userID, req.Mode)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "โหลดหมวดหมู่ไม่สำเร็จ"})
			return
		}
	}

	result, err := h.parseQuickEntryWithLLM(req.Mode, req.Text, categories)
	if err != nil {
		result = parseQuickEntryFallback(req.Mode, req.Text)
	}

	result.Title = strings.TrimSpace(result.Title)
	if result.Title == "" {
		result.Title = strings.TrimSpace(req.Text)
	}
	result.Amount = math.Round(result.Amount*100) / 100
	if result.Amount <= 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "ไม่พบจำนวนเงินที่ถูกต้องในข้อความ"})
		return
	}
	if result.Confidence <= 0 {
		result.Confidence = 0.45
	}
	if result.Confidence > 1 {
		result.Confidence = 1
	}

	var categoryID *string
	var categoryName *string
	if req.Mode == "income" || req.Mode == "expense" {
		if matched := matchQuickEntryCategory(result.CategoryName, categories); matched != nil {
			categoryID = &matched.ID
			categoryName = &matched.Name
		}
	}

	c.JSON(http.StatusOK, quickEntryParseResponse{
		Mode:         req.Mode,
		Title:        result.Title,
		Amount:       result.Amount,
		CategoryID:   categoryID,
		CategoryName: categoryName,
		Confidence:   result.Confidence,
		NeedsReview:  result.Confidence < 0.75 || (req.Mode != "saving" && categoryID == nil),
	})
}

func (h *QuickEntryHandler) listQuickEntryCategories(ctx context.Context, userID, txType string) ([]quickEntryCategory, error) {
	rows, err := h.db.Query(ctx,
		`SELECT id, name
		 FROM categories
		 WHERE (user_id = $1 OR user_id IS NULL) AND type = $2
		 ORDER BY
		   CASE WHEN user_id IS NOT NULL THEN 0 WHEN name = 'อื่นๆ' THEN 2 ELSE 1 END,
		   created_at ASC`,
		userID, txType,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	categories := []quickEntryCategory{}
	for rows.Next() {
		var cat quickEntryCategory
		if err := rows.Scan(&cat.ID, &cat.Name); err != nil {
			continue
		}
		categories = append(categories, cat)
	}
	return categories, rows.Err()
}

func (h *QuickEntryHandler) parseQuickEntryWithLLM(mode, text string, categories []quickEntryCategory) (*quickEntryLLMResult, error) {
	if h.cfg.Typhoon.APIKey == "" {
		return nil, fmt.Errorf("missing typhoon api key")
	}
	if err := waitTyphoonLLM(context.Background()); err != nil {
		return nil, err
	}

	categoryNames := []string{}
	for _, cat := range categories {
		categoryNames = append(categoryNames, cat.Name)
	}
	categoryText := "ไม่ต้องเลือกหมวดหมู่"
	if len(categoryNames) > 0 {
		categoryText = strings.Join(categoryNames, ", ")
	}

	prompt := `คุณคือผู้ช่วยแยกข้อมูลรายการการเงินแบบสั้นของแอป PaoJot
ตอบเป็น JSON เท่านั้น ห้ามมี markdown หรือข้อความอื่น
รูปแบบ:
{
  "title": "ชื่อรายการแบบสั้น",
  "amount": 0.00,
  "category_name": "ชื่อหมวดหมู่จากรายการที่ให้มา หรือ null",
  "confidence": 0.0
}
กฎ:
- amount ต้องเป็นตัวเลขบวกเท่านั้น ไม่มี comma
- title ให้ตัดจำนวนเงินและคำว่า บาท ออก
- ถ้า mode เป็น saving ให้ category_name=null
- ถ้า mode เป็น income หรือ expense ให้เลือก category_name จากหมวดหมู่ที่ให้มาเท่านั้น
- ถ้าไม่มั่นใจหมวดหมู่ ให้ category_name=null และ confidence ต่ำกว่า 0.75`

	userContent := fmt.Sprintf("mode: %s\nข้อความ: %s\nหมวดหมู่ที่เลือกได้: %s", mode, text, categoryText)
	payload := llmChatReq{
		Model: h.cfg.Typhoon.ExtractModel,
		Messages: []llmChatMsg{
			{Role: "system", Content: prompt},
			{Role: "user", Content: userContent},
		},
		MaxTokens:   400,
		Temperature: 0.1,
		TopP:        0.6,
	}

	body, _ := json.Marshal(payload)
	httpReq, err := http.NewRequest("POST", h.cfg.Typhoon.BaseURL+"/chat/completions", bytes.NewReader(body))
	if err != nil {
		return nil, err
	}
	httpReq.Header.Set("Authorization", "Bearer "+h.cfg.Typhoon.APIKey)
	httpReq.Header.Set("Content-Type", "application/json")

	client := &http.Client{Timeout: 45 * time.Second}
	resp, err := client.Do(httpReq)
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
		return nil, err
	}
	if len(llmResp.Choices) == 0 {
		return nil, fmt.Errorf("LLM ไม่ได้ผลลัพธ์กลับมา")
	}

	content := strings.TrimSpace(llmResp.Choices[0].Message.Content)
	content = strings.TrimPrefix(content, "```json")
	content = strings.TrimPrefix(content, "```")
	content = strings.TrimSuffix(content, "```")
	content = strings.TrimSpace(content)

	var result quickEntryLLMResult
	if err := json.Unmarshal([]byte(content), &result); err != nil {
		return nil, fmt.Errorf("parse JSON ไม่ได้: %v | content: %s", err, content)
	}
	return &result, nil
}

func parseQuickEntryFallback(mode, text string) *quickEntryLLMResult {
	amount := 0.0
	amountText := ""
	re := regexp.MustCompile(`[-+]?\d+(?:[,.]\d+)?`)
	matches := re.FindAllString(text, -1)
	if len(matches) > 0 {
		amountText = matches[len(matches)-1]
		parsed, _ := strconv.ParseFloat(strings.ReplaceAll(amountText, ",", ""), 64)
		amount = parsed
	}

	title := strings.TrimSpace(text)
	if amountText != "" {
		title = strings.TrimSpace(strings.Replace(title, amountText, "", 1))
	}
	title = strings.TrimSpace(strings.ReplaceAll(title, "บาท", ""))
	for _, word := range []string{"รายรับ", "รายจ่าย", "จ่าย", "รับ", "ออมเงิน", "ออม"} {
		title = strings.TrimSpace(strings.TrimPrefix(title, word))
	}
	if title == "" {
		if mode == "income" {
			title = "รายรับ"
		} else if mode == "saving" {
			title = "ออมเงิน"
		} else {
			title = "รายจ่าย"
		}
	}

	return &quickEntryLLMResult{
		Title:      title,
		Amount:     amount,
		Confidence: 0.45,
	}
}

func matchQuickEntryCategory(name *string, categories []quickEntryCategory) *quickEntryCategory {
	if name == nil {
		return nil
	}
	normalized := normalizeQuickEntryText(*name)
	if normalized == "" {
		return nil
	}
	for _, cat := range categories {
		if normalizeQuickEntryText(cat.Name) == normalized {
			return &cat
		}
	}
	for _, cat := range categories {
		catName := normalizeQuickEntryText(cat.Name)
		if strings.Contains(catName, normalized) || strings.Contains(normalized, catName) {
			return &cat
		}
	}
	return nil
}

func normalizeQuickEntryText(s string) string {
	return strings.ToLower(strings.Join(strings.Fields(strings.TrimSpace(s)), ""))
}
