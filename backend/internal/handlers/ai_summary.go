package handlers

import (
	"bytes"
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"strings"
	"time"

	"paomoney/internal/config"

	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

type AISummaryHandler struct {
	db  *pgxpool.Pool
	cfg *config.Config
}

func NewAISummaryHandler(db *pgxpool.Pool, cfg *config.Config) *AISummaryHandler {
	h := &AISummaryHandler{db: db, cfg: cfg}
	if err := h.ensureTable(context.Background()); err != nil {
		log.Printf("failed to ensure ai_summaries table: %v", err)
	}
	return h
}

type aiSummaryRequest struct {
	PeriodType string `json:"period_type" binding:"required,oneof=weekly monthly"`
}

type aiSummaryResponse struct {
	PeriodType     string           `json:"period_type"`
	PeriodStart    string           `json:"period_start"`
	PeriodEnd      string           `json:"period_end"`
	WeekStartDay   int              `json:"week_start_day"`
	Model          string           `json:"model"`
	DataHash       string           `json:"data_hash"`
	Eligible       bool             `json:"eligible"`
	Reason         string           `json:"reason,omitempty"`
	AIConsent      bool             `json:"ai_consent"`
	AIConsentAt    *time.Time       `json:"ai_consent_at,omitempty"`
	Summary        *aiSummaryResult `json:"summary,omitempty"`
	Cached         bool             `json:"cached"`
	Stale          bool             `json:"stale"`
	TransactionCnt int              `json:"transaction_count"`
	ExpenseCnt     int              `json:"expense_count"`
}

type aiSummaryResult struct {
	Title       string   `json:"title"`
	Overview    string   `json:"overview"`
	Highlights  []string `json:"highlights"`
	Cautions    []string `json:"cautions"`
	Suggestions []string `json:"suggestions"`
}

type aiSummaryInput struct {
	PeriodType           string               `json:"period_type"`
	PeriodStart          string               `json:"period_start"`
	PeriodEnd            string               `json:"period_end"`
	WeekStartDay         int                  `json:"week_start_day"`
	IncomeTotal          float64              `json:"income_total"`
	ExpenseTotal         float64              `json:"expense_total"`
	TransactionCount     int                  `json:"transaction_count"`
	ExpenseCount         int                  `json:"expense_count"`
	TopExpenseCategories []aiCategorySpend    `json:"top_expense_categories"`
	BudgetAlerts         []aiBudgetAlert      `json:"budget_alerts,omitempty"`
	Comparison           *aiComparison        `json:"comparison,omitempty"`
	SavingsGoalContext   *aiSavingsGoalCtx    `json:"savings_goal_context,omitempty"`
	LargeExpenseExamples []aiTransactionBrief `json:"large_expense_examples,omitempty"`
}

type aiCategorySpend struct {
	Name   string  `json:"name"`
	Amount float64 `json:"amount"`
}

type aiBudgetAlert struct {
	Name        string  `json:"name"`
	Amount      float64 `json:"amount"`
	Spent       float64 `json:"spent"`
	Remaining   float64 `json:"remaining"`
	UsedPercent float64 `json:"used_percent"`
}

type aiComparison struct {
	PreviousStart        string   `json:"previous_start"`
	PreviousEnd          string   `json:"previous_end"`
	PreviousExpenseTotal float64  `json:"previous_expense_total"`
	ExpenseChangePercent *float64 `json:"expense_change_percent,omitempty"`
}

type aiSavingsGoalCtx struct {
	ActiveGoals      int     `json:"active_goals"`
	TotalRemaining   float64 `json:"total_remaining"`
	NearestGoalName  string  `json:"nearest_goal_name,omitempty"`
	NearestRemaining float64 `json:"nearest_remaining,omitempty"`
}

type aiTransactionBrief struct {
	Name   string  `json:"name"`
	Amount float64 `json:"amount"`
	Date   string  `json:"date"`
}

func (h *AISummaryHandler) ensureTable(ctx context.Context) error {
	_, err := h.db.Exec(ctx, `
		CREATE TABLE IF NOT EXISTS ai_summaries (
			id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
			user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
			period_type TEXT NOT NULL,
			period_start DATE NOT NULL,
			period_end DATE NOT NULL,
			week_start_day INTEGER NOT NULL DEFAULT 1,
			model TEXT NOT NULL,
			data_hash TEXT NOT NULL,
			summary_json JSONB NOT NULL,
			created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
			updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
			UNIQUE (user_id, period_type, period_start, period_end, week_start_day)
		)
	`)
	return err
}

// GET /api/v1/ai-summary?period_type=weekly|monthly
func (h *AISummaryHandler) Get(c *gin.Context) {
	userID := c.GetString("user_id")
	periodType := c.DefaultQuery("period_type", "monthly")
	if periodType != "weekly" && periodType != "monthly" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "period_type must be weekly or monthly"})
		return
	}

	resp, err := h.buildResponse(c.Request.Context(), userID, periodType, false)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, resp)
}

// POST /api/v1/ai-summary
func (h *AISummaryHandler) Generate(c *gin.Context) {
	userID := c.GetString("user_id")
	var req aiSummaryRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	resp, err := h.buildResponse(c.Request.Context(), userID, req.PeriodType, true)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	if !resp.Eligible {
		c.JSON(http.StatusBadRequest, resp)
		return
	}
	c.JSON(http.StatusOK, resp)
}

func (h *AISummaryHandler) buildResponse(ctx context.Context, userID, periodType string, generate bool) (*aiSummaryResponse, error) {
	weekStartDay, _ := h.getWeekStartDay(ctx, userID)
	start, end := currentPeriodRange(periodType, weekStartDay)
	consent, consentAt, err := h.getAIConsent(ctx, userID)
	if err != nil {
		return nil, err
	}
	if !consent {
		return &aiSummaryResponse{
			PeriodType:   periodType,
			PeriodStart:  start.Format("2006-01-02"),
			PeriodEnd:    end.Format("2006-01-02"),
			WeekStartDay: weekStartDay,
			Model:        h.cfg.Gemini.Model,
			Eligible:     false,
			Reason:       "กรุณาเปิดการยินยอมใช้ข้อมูลกับ AI ในหน้าโปรไฟล์ก่อน",
			AIConsent:    false,
		}, nil
	}
	input, err := h.buildInput(ctx, userID, periodType, start, end, weekStartDay)
	if err != nil {
		return nil, err
	}
	dataHash := hashSummaryInput(input)
	eligible, reason := summaryEligibility(input)

	resp := &aiSummaryResponse{
		PeriodType:     periodType,
		PeriodStart:    start.Format("2006-01-02"),
		PeriodEnd:      end.Format("2006-01-02"),
		WeekStartDay:   weekStartDay,
		Model:          h.cfg.Gemini.Model,
		DataHash:       dataHash,
		Eligible:       eligible,
		Reason:         reason,
		AIConsent:      consent,
		AIConsentAt:    consentAt,
		TransactionCnt: input.TransactionCount,
		ExpenseCnt:     input.ExpenseCount,
	}

	cached, cachedHash, err := h.loadCachedSummary(ctx, userID, periodType, start, end, weekStartDay)
	if err != nil && err != pgx.ErrNoRows {
		return nil, err
	}
	if cached != nil {
		resp.Summary = cached
		resp.Cached = cachedHash == dataHash
		resp.Stale = cachedHash != dataHash
	} else {
		// No summary exists for the current period yet
		if eligible {
			// AUTOMATIC GENERATION: If eligible and no summary exists, generate it automatically
			summary, err := h.callGeminiSummary(input)
			if err == nil {
				if err := h.saveSummary(ctx, userID, input, dataHash, summary); err == nil {
					resp.Summary = summary
					resp.Cached = true
					resp.Stale = false
				}
			}
		}

		// Fallback: If auto-generation wasn't run (ineligible) or failed, AND we are just viewing (GET request)
		if resp.Summary == nil && !generate {
			var raw []byte
			var prevStart, prevEnd time.Time
			var prevDataHash, prevModel string
			err := h.db.QueryRow(ctx, `
				SELECT summary_json, period_start, period_end, data_hash, model
				FROM ai_summaries
				WHERE user_id = $1 AND period_type = $2
				ORDER BY period_end DESC
				LIMIT 1
			`, userID, periodType).Scan(&raw, &prevStart, &prevEnd, &prevDataHash, &prevModel)

			if err == nil {
				var summary aiSummaryResult
				if err := json.Unmarshal(raw, &summary); err == nil {
					resp.Summary = &summary
					resp.PeriodStart = prevStart.Format("2006-01-02")
					resp.PeriodEnd = prevEnd.Format("2006-01-02")
					resp.Model = prevModel
					resp.DataHash = prevDataHash
					resp.Cached = true
					resp.Stale = false
				}
			}
		}
	}

	if !generate {
		return resp, nil
	}
	if !eligible {
		resp.Summary = nil
		resp.Cached = false
		resp.Stale = false
		return resp, nil
	}
	if cached != nil && resp.Cached {
		return resp, nil
	}

	summary, err := h.callGeminiSummary(input)
	if err != nil {
		return nil, err
	}
	if err := h.saveSummary(ctx, userID, input, dataHash, summary); err != nil {
		return nil, err
	}
	resp.Summary = summary
	resp.Cached = false
	resp.Stale = false
	return resp, nil
}

func (h *AISummaryHandler) getWeekStartDay(ctx context.Context, userID string) (int, error) {
	var day int
	err := h.db.QueryRow(ctx, `SELECT week_start_day FROM user_profiles WHERE user_id = $1`, userID).Scan(&day)
	if err != nil {
		return 1, err
	}
	if day < 0 || day > 6 {
		return 1, nil
	}
	return day, nil
}

func (h *AISummaryHandler) getAIConsent(ctx context.Context, userID string) (bool, *time.Time, error) {
	var enabled bool
	var consentAt *time.Time
	err := h.db.QueryRow(ctx,
		`SELECT ai_summary_enabled, ai_summary_consent_at
		 FROM user_profiles WHERE user_id = $1`,
		userID,
	).Scan(&enabled, &consentAt)
	return enabled, consentAt, err
}

func (h *AISummaryHandler) buildInput(ctx context.Context, userID, periodType string, start, end time.Time, weekStartDay int) (*aiSummaryInput, error) {
	income, expense, txCount, expenseCount, err := h.periodTotals(ctx, userID, start, end)
	if err != nil {
		return nil, err
	}
	topCats, err := h.topExpenseCategories(ctx, userID, start, end)
	if err != nil {
		return nil, err
	}
	budgets, err := h.budgetAlerts(ctx, userID, periodType, start, end)
	if err != nil {
		return nil, err
	}
	comparison, err := h.comparison(ctx, userID, periodType, start, end)
	if err != nil {
		return nil, err
	}
	goals, err := h.savingsGoalContext(ctx, userID)
	if err != nil {
		return nil, err
	}
	largeExpenses, err := h.largeExpenseExamples(ctx, userID, start, end)
	if err != nil {
		return nil, err
	}

	return &aiSummaryInput{
		PeriodType:           periodType,
		PeriodStart:          start.Format("2006-01-02"),
		PeriodEnd:            end.Format("2006-01-02"),
		WeekStartDay:         weekStartDay,
		IncomeTotal:          income,
		ExpenseTotal:         expense,
		TransactionCount:     txCount,
		ExpenseCount:         expenseCount,
		TopExpenseCategories: topCats,
		BudgetAlerts:         budgets,
		Comparison:           comparison,
		SavingsGoalContext:   goals,
		LargeExpenseExamples: largeExpenses,
	}, nil
}

func (h *AISummaryHandler) periodTotals(ctx context.Context, userID string, start, end time.Time) (float64, float64, int, int, error) {
	var income, expense float64
	var txCount, expenseCount int
	err := h.db.QueryRow(ctx, `
		SELECT
			COALESCE(SUM(CASE WHEN type = 'income' THEN amount ELSE 0 END), 0),
			COALESCE(SUM(CASE WHEN type = 'expense' THEN amount ELSE 0 END), 0),
			COUNT(*) FILTER (WHERE type IN ('income', 'expense')),
			COUNT(*) FILTER (WHERE type = 'expense')
		FROM transactions
		WHERE user_id = $1 AND transaction_date >= $2 AND transaction_date <= $3
	`, userID, start.Format("2006-01-02"), end.Format("2006-01-02")).Scan(&income, &expense, &txCount, &expenseCount)
	return income, expense, txCount, expenseCount, err
}

func (h *AISummaryHandler) topExpenseCategories(ctx context.Context, userID string, start, end time.Time) ([]aiCategorySpend, error) {
	rows, err := h.db.Query(ctx, `
		SELECT COALESCE(c.name, 'อื่น ๆ') AS category_name, SUM(t.amount) AS total
		FROM transactions t
		LEFT JOIN categories c ON c.id = t.category_id
		WHERE t.user_id = $1 AND t.type = 'expense'
		  AND t.transaction_date >= $2 AND t.transaction_date <= $3
		GROUP BY category_name
		ORDER BY total DESC
		LIMIT 5
	`, userID, start.Format("2006-01-02"), end.Format("2006-01-02"))
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	items := []aiCategorySpend{}
	for rows.Next() {
		var item aiCategorySpend
		if err := rows.Scan(&item.Name, &item.Amount); err == nil {
			items = append(items, item)
		}
	}
	return items, rows.Err()
}

func (h *AISummaryHandler) budgetAlerts(ctx context.Context, userID, periodType string, start, end time.Time) ([]aiBudgetAlert, error) {
	rows, err := h.db.Query(ctx, `
		SELECT COALESCE(c.name, 'รวมทุกหมวด'), b.amount,
		       COALESCE((
		         SELECT SUM(t.amount)
		         FROM transactions t
		         WHERE t.user_id = b.user_id
		           AND t.type = 'expense'
		           AND (b.category_id IS NULL OR t.category_id = b.category_id)
		           AND t.transaction_date >= $2 AND t.transaction_date <= $3
		       ), 0) AS spent
		FROM budgets b
		LEFT JOIN categories c ON c.id = b.category_id
		WHERE b.user_id = $1
		  AND b.is_active = TRUE
		  AND b.start_date <= $3
		  AND b.end_date >= $2
		ORDER BY b.created_at DESC
	`, userID, start.Format("2006-01-02"), end.Format("2006-01-02"))
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	alerts := []aiBudgetAlert{}
	for rows.Next() {
		var a aiBudgetAlert
		if err := rows.Scan(&a.Name, &a.Amount, &a.Spent); err != nil {
			continue
		}
		a.Remaining = a.Amount - a.Spent
		if a.Amount > 0 {
			a.UsedPercent = (a.Spent / a.Amount) * 100
		}
		if a.UsedPercent >= 70 || a.Remaining <= 0 {
			alerts = append(alerts, a)
		}
	}
	return alerts, rows.Err()
}

func (h *AISummaryHandler) comparison(ctx context.Context, userID, periodType string, start, end time.Time) (*aiComparison, error) {
	var prevStart, prevEnd time.Time
	if periodType == "weekly" {
		prevStart = start.AddDate(0, 0, -7)
		prevEnd = end.AddDate(0, 0, -7)
	} else {
		prevStart = start.AddDate(0, -1, 0)
		prevEnd = start.AddDate(0, 0, -1)
	}

	var prevExpense float64
	err := h.db.QueryRow(ctx, `
		SELECT COALESCE(SUM(amount), 0)
		FROM transactions
		WHERE user_id = $1 AND type = 'expense'
		  AND transaction_date >= $2 AND transaction_date <= $3
	`, userID, prevStart.Format("2006-01-02"), prevEnd.Format("2006-01-02")).Scan(&prevExpense)
	if err != nil {
		return nil, err
	}

	_, expense, _, _, err := h.periodTotals(ctx, userID, start, end)
	if err != nil {
		return nil, err
	}

	var change *float64
	if prevExpense > 0 {
		v := ((expense - prevExpense) / prevExpense) * 100
		change = &v
	}
	return &aiComparison{
		PreviousStart:        prevStart.Format("2006-01-02"),
		PreviousEnd:          prevEnd.Format("2006-01-02"),
		PreviousExpenseTotal: prevExpense,
		ExpenseChangePercent: change,
	}, nil
}

func (h *AISummaryHandler) savingsGoalContext(ctx context.Context, userID string) (*aiSavingsGoalCtx, error) {
	rows, err := h.db.Query(ctx, `
		SELECT name, target_amount, current_amount
		FROM savings_goals
		WHERE user_id = $1 AND status = 'in_progress'
	`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	ctxData := &aiSavingsGoalCtx{}
	for rows.Next() {
		var name string
		var target, current float64
		if err := rows.Scan(&name, &target, &current); err != nil {
			continue
		}
		remaining := target - current
		if remaining < 0 {
			remaining = 0
		}
		ctxData.ActiveGoals++
		ctxData.TotalRemaining += remaining
		if ctxData.NearestGoalName == "" || remaining < ctxData.NearestRemaining {
			ctxData.NearestGoalName = name
			ctxData.NearestRemaining = remaining
		}
	}
	if ctxData.ActiveGoals == 0 {
		return nil, rows.Err()
	}
	return ctxData, rows.Err()
}

func (h *AISummaryHandler) largeExpenseExamples(ctx context.Context, userID string, start, end time.Time) ([]aiTransactionBrief, error) {
	rows, err := h.db.Query(ctx, `
		SELECT COALESCE(name, 'รายจ่าย'), amount, transaction_date::date::text
		FROM transactions
		WHERE user_id = $1 AND type = 'expense'
		  AND transaction_date >= $2 AND transaction_date <= $3
		ORDER BY amount DESC
		LIMIT 5
	`, userID, start.Format("2006-01-02"), end.Format("2006-01-02"))
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	items := []aiTransactionBrief{}
	for rows.Next() {
		var item aiTransactionBrief
		if err := rows.Scan(&item.Name, &item.Amount, &item.Date); err == nil {
			items = append(items, item)
		}
	}
	return items, rows.Err()
}

var aiSummaryPrompt = `คุณคือผู้ช่วยสรุปพฤติกรรมการเงินของผู้ใช้

หน้าที่:
- สรุปข้อมูลรายสัปดาห์หรือรายเดือนจาก JSON ที่ backend คำนวณไว้แล้ว
- อิงธุรกรรมเป็นหลัก งบประมาณเป็นตัวช่วยเตือน เป้าหมายการออมเป็นข้อมูลเสริม
- ห้ามแต่งตัวเลขใหม่ ห้ามคำนวณตัวเลขใหม่เองถ้าไม่มีอยู่ในข้อมูล
- ถ้าไม่มีงบประมาณ ห้ามพูดว่าเกินงบหรือใกล้เต็มงบ
- ถ้าไม่มีเป้าหมายการออม ห้ามพูดถึงเป้าหมายการออม
- ถ้าไม่มีข้อมูลเปรียบเทียบหรือค่า expense_change_percent เป็น null ห้ามสรุปว่าเพิ่มขึ้น/ลดลงกี่เปอร์เซ็นต์

ตอบเป็น JSON เท่านั้น ห้ามมี markdown หรือข้อความอื่น:
{
  "title": "หัวข้อสั้น ๆ",
  "overview": "สรุปภาพรวม 1-2 ประโยค",
  "highlights": ["ข้อสังเกตสำคัญ 1", "ข้อสังเกตสำคัญ 2"],
  "cautions": ["จุดที่ควรระวัง"],
  "suggestions": ["คำแนะนำที่ทำได้จริง 1", "คำแนะนำที่ทำได้จริง 2", "คำแนะนำที่ทำได้จริง 3"]
}

น้ำเสียง:
- ภาษาไทย อ่านง่าย เป็นกันเอง
- ไม่ตำหนิผู้ใช้
- กระชับ เหมาะกับการแสดงใน Card Dashboard`

type geminiChatReq struct {
	Model       string       `json:"model"`
	Messages    []llmChatMsg `json:"messages"`
	Temperature float64      `json:"temperature"`
	TopP        float64      `json:"top_p"`
}

func (h *AISummaryHandler) callGeminiSummary(input *aiSummaryInput) (*aiSummaryResult, error) {
	inputJSON, _ := json.MarshalIndent(input, "", "  ")
	payload := geminiChatReq{
		Model: h.cfg.Gemini.Model,
		Messages: []llmChatMsg{
			{Role: "system", Content: aiSummaryPrompt},
			{Role: "user", Content: "ช่วยสรุปข้อมูลการเงินนี้:\n\n" + string(inputJSON)},
		},
		Temperature: 0.25,
		TopP:        0.6,
	}

	body, _ := json.Marshal(payload)
	req, err := http.NewRequest("POST", h.cfg.Gemini.BaseURL+"/chat/completions", bytes.NewReader(body))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Authorization", "Bearer "+h.cfg.Gemini.APIKey)
	req.Header.Set("Content-Type", "application/json")

	client := &http.Client{Timeout: 75 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		b, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("Gemini LLM %d: %s", resp.StatusCode, string(b))
	}

	var llmResp llmChatResp
	if err := json.NewDecoder(resp.Body).Decode(&llmResp); err != nil {
		return nil, fmt.Errorf("decode LLM response: %v", err)
	}
	if len(llmResp.Choices) == 0 {
		return nil, fmt.Errorf("LLM ไม่ได้ผลลัพธ์กลับมา")
	}

	content := strings.TrimSpace(llmResp.Choices[0].Message.Content)
	content = strings.TrimPrefix(content, "```json")
	content = strings.TrimPrefix(content, "```")
	content = strings.TrimSuffix(content, "```")
	content = strings.TrimSpace(content)

	var result aiSummaryResult
	if err := json.Unmarshal([]byte(content), &result); err != nil {
		return &aiSummaryResult{
			Title:    "สรุปการเงิน",
			Overview: content,
		}, nil
	}
	return &result, nil
}

func (h *AISummaryHandler) loadCachedSummary(ctx context.Context, userID, periodType string, start, end time.Time, weekStartDay int) (*aiSummaryResult, string, error) {
	var raw []byte
	var dataHash string
	err := h.db.QueryRow(ctx, `
		SELECT summary_json, data_hash
		FROM ai_summaries
		WHERE user_id = $1 AND period_type = $2 AND period_start = $3 AND period_end = $4 AND week_start_day = $5
	`, userID, periodType, start.Format("2006-01-02"), end.Format("2006-01-02"), weekStartDay).Scan(&raw, &dataHash)
	if err != nil {
		return nil, "", err
	}
	var summary aiSummaryResult
	if err := json.Unmarshal(raw, &summary); err != nil {
		return nil, "", err
	}
	return &summary, dataHash, nil
}

func (h *AISummaryHandler) saveSummary(ctx context.Context, userID string, input *aiSummaryInput, dataHash string, summary *aiSummaryResult) error {
	raw, _ := json.Marshal(summary)
	_, err := h.db.Exec(ctx, `
		INSERT INTO ai_summaries (id, user_id, period_type, period_start, period_end, week_start_day, model, data_hash, summary_json)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
		ON CONFLICT (user_id, period_type, period_start, period_end, week_start_day)
		DO UPDATE SET model = EXCLUDED.model, data_hash = EXCLUDED.data_hash, summary_json = EXCLUDED.summary_json, updated_at = NOW()
	`, randomID(), userID, input.PeriodType, input.PeriodStart, input.PeriodEnd, input.WeekStartDay, h.cfg.Gemini.Model, dataHash, raw)
	return err
}

func summaryEligibility(input *aiSummaryInput) (bool, string) {
	if input.ExpenseCount == 0 {
		return false, "ยังไม่มีรายจ่ายในช่วงนี้"
	}
	if input.PeriodType == "weekly" {
		if input.TransactionCount <= 10 {
			return false, "ต้องมีรายการรายรับ/รายจ่ายมากกว่า 10 รายการในสัปดาห์นี้ก่อน จึงจะสรุปด้วย AI ได้"
		}
		return true, ""
	}
	if input.TransactionCount <= 10 {
		return false, "ต้องมีรายการรายรับ/รายจ่ายมากกว่า 10 รายการในเดือนนี้ก่อน จึงจะสรุปด้วย AI ได้"
	}
	return true, ""
}

func hashSummaryInput(input *aiSummaryInput) string {
	raw, _ := json.Marshal(input)
	sum := sha256.Sum256(raw)
	return hex.EncodeToString(sum[:])
}

func currentPeriodRange(periodType string, weekStartDay int) (time.Time, time.Time) {
	now := time.Now()
	loc := now.Location()
	today := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, loc)
	if periodType == "weekly" {
		diff := int(today.Weekday()) - weekStartDay
		if diff < 0 {
			diff += 7
		}
		start := today.AddDate(0, 0, -diff)
		return start, start.AddDate(0, 0, 6)
	}
	start := time.Date(today.Year(), today.Month(), 1, 0, 0, 0, 0, loc)
	end := start.AddDate(0, 1, -1)
	return start, end
}

func randomID() string {
	b := make([]byte, 16)
	if _, err := rand.Read(b); err != nil {
		return fmt.Sprintf("%d", time.Now().UnixNano())
	}
	return hex.EncodeToString(b)
}
