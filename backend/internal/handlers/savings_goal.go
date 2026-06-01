package handlers

import (
	"context"
	"fmt"
	"io"
	"net/http"
	"os"
	"paomoney/internal/models"
	"path/filepath"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5/pgxpool"
)

type SavingsGoalHandler struct {
	db *pgxpool.Pool
}

func NewSavingsGoalHandler(db *pgxpool.Pool) *SavingsGoalHandler {
	h := &SavingsGoalHandler{db: db}
	h.ensureSchema()
	return h
}

func (h *SavingsGoalHandler) ensureSchema() {
	_, _ = h.db.Exec(context.Background(), `
		ALTER TABLE savings_goals
		ADD COLUMN IF NOT EXISTS start_date DATE NOT NULL DEFAULT CURRENT_DATE;
	`)
}

// POST /api/v1/savings-goals/images
func (h *SavingsGoalHandler) UploadImage(c *gin.Context) {
	file, fh, err := c.Request.FormFile("image")
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "กรุณาเลือกรูปภาพ"})
		return
	}
	defer file.Close()

	mimeType := fh.Header.Get("Content-Type")
	if mimeType != "image/jpeg" && mimeType != "image/png" && mimeType != "image/webp" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "รองรับเฉพาะไฟล์ JPG, PNG หรือ WEBP"})
		return
	}
	if fh.Size > 5*1024*1024 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "รูปภาพต้องมีขนาดไม่เกิน 5MB"})
		return
	}

	data, err := io.ReadAll(file)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "อ่านไฟล์รูปภาพไม่สำเร็จ"})
		return
	}

	uploadsDir := "uploads/goals"
	if err := os.MkdirAll(uploadsDir, 0755); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "สร้างโฟลเดอร์รูปภาพไม่สำเร็จ"})
		return
	}

	ext := ".jpg"
	if mimeType == "image/png" {
		ext = ".png"
	} else if mimeType == "image/webp" {
		ext = ".webp"
	}

	userID := c.GetString("user_id")
	filename := fmt.Sprintf("%s_%d%s", userID[:8], time.Now().UnixNano(), ext)
	filePath := filepath.Join(uploadsDir, filename)
	if err := os.WriteFile(filePath, data, 0644); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "บันทึกรูปภาพไม่สำเร็จ"})
		return
	}

	scheme := "http"
	if c.Request.TLS != nil {
		scheme = "https"
	}
	if forwarded := c.GetHeader("X-Forwarded-Proto"); forwarded != "" {
		scheme = forwarded
	}

	c.JSON(http.StatusOK, gin.H{"image_url": fmt.Sprintf("%s://%s/%s", scheme, c.Request.Host, filepath.ToSlash(filePath))})
}

// GET /api/v1/savings-goals
func (h *SavingsGoalHandler) List(c *gin.Context) {
	userID := c.GetString("user_id")

	rows, err := h.db.Query(context.Background(),
		`SELECT id, user_id, account_id, name, image_url, target_amount, current_amount, start_date, deadline, status, created_at, updated_at
		 FROM savings_goals WHERE user_id = $1 ORDER BY created_at DESC`,
		userID,
	)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to fetch savings goals"})
		return
	}
	defer rows.Close()

	goals := []models.SavingsGoal{}
	for rows.Next() {
		var g models.SavingsGoal
		if err := rows.Scan(&g.ID, &g.UserID, &g.AccountID, &g.Name, &g.ImageURL, &g.TargetAmount,
			&g.CurrentAmount, &g.StartDate, &g.Deadline, &g.Status, &g.CreatedAt, &g.UpdatedAt); err != nil {
			continue
		}
		goals = append(goals, g)
	}

	c.JSON(http.StatusOK, goals)
}

// POST /api/v1/savings-goals
func (h *SavingsGoalHandler) Create(c *gin.Context) {
	userID := c.GetString("user_id")

	var req models.CreateSavingsGoalRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if req.AccountID == nil || *req.AccountID == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "กรุณาเลือกบัญชีเก็บออม"})
		return
	}
	req.Name = strings.TrimSpace(req.Name)
	if req.Name == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "กรุณากรอกชื่อเป้าหมาย"})
		return
	}
	nameExists, err := h.savingsGoalNameExists(c.Request.Context(), userID, req.Name, "")
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to validate savings goal name"})
		return
	}
	if nameExists {
		c.JSON(http.StatusBadRequest, gin.H{"error": "มีเป้าหมายชื่อนี้อยู่แล้ว"})
		return
	}

	startDate := time.Now()
	if req.StartDate != nil && strings.TrimSpace(*req.StartDate) != "" {
		parsed, err := time.Parse("2006-01-02", *req.StartDate)
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid start_date format, use YYYY-MM-DD"})
			return
		}
		startDate = parsed
	}

	var deadline *time.Time
	if req.Deadline != nil && strings.TrimSpace(*req.Deadline) != "" {
		parsed, err := time.Parse("2006-01-02", *req.Deadline)
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid deadline format, use YYYY-MM-DD"})
			return
		}
		if parsed.Before(startDate) {
			c.JSON(http.StatusBadRequest, gin.H{"error": "วันที่สิ้นสุดต้องไม่ก่อนวันที่เริ่มต้น"})
			return
		}
		deadline = &parsed
	}
	var g models.SavingsGoal
	err = h.db.QueryRow(context.Background(),
		`INSERT INTO savings_goals (user_id, account_id, name, image_url, target_amount, current_amount, start_date, deadline, status)
		 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
		 RETURNING id, user_id, account_id, name, image_url, target_amount, current_amount, start_date, deadline, status, created_at, updated_at`,
		userID, req.AccountID, req.Name, req.ImageURL, req.TargetAmount, 0, startDate, deadline, models.GoalStatusInProgress,
	).Scan(&g.ID, &g.UserID, &g.AccountID, &g.Name, &g.ImageURL, &g.TargetAmount,
		&g.CurrentAmount, &g.StartDate, &g.Deadline, &g.Status, &g.CreatedAt, &g.UpdatedAt)

	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to create savings goal"})
		return
	}

	c.JSON(http.StatusCreated, g)
}

// GET /api/v1/savings-goals/:id
func (h *SavingsGoalHandler) Get(c *gin.Context) {
	userID := c.GetString("user_id")
	id := c.Param("id")

	var g models.SavingsGoal
	err := h.db.QueryRow(context.Background(),
		`SELECT id, user_id, account_id, name, image_url, target_amount, current_amount, start_date, deadline, status, created_at, updated_at
		 FROM savings_goals WHERE id = $1 AND user_id = $2`,
		id, userID,
	).Scan(&g.ID, &g.UserID, &g.AccountID, &g.Name, &g.ImageURL, &g.TargetAmount,
		&g.CurrentAmount, &g.StartDate, &g.Deadline, &g.Status, &g.CreatedAt, &g.UpdatedAt)

	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "savings goal not found"})
		return
	}

	c.JSON(http.StatusOK, g)
}

// PUT /api/v1/savings-goals/:id
func (h *SavingsGoalHandler) Update(c *gin.Context) {
	userID := c.GetString("user_id")
	id := c.Param("id")

	var req models.UpdateSavingsGoalRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if req.AccountID != nil && *req.AccountID == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "กรุณาเลือกบัญชีเก็บออม"})
		return
	}
	if req.Name != nil {
		name := strings.TrimSpace(*req.Name)
		if name == "" {
			c.JSON(http.StatusBadRequest, gin.H{"error": "กรุณากรอกชื่อเป้าหมาย"})
			return
		}
		nameExists, err := h.savingsGoalNameExists(c.Request.Context(), userID, name, id)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to validate savings goal name"})
			return
		}
		if nameExists {
			c.JSON(http.StatusBadRequest, gin.H{"error": "มีเป้าหมายชื่อนี้อยู่แล้ว"})
			return
		}
		req.Name = &name
	}

	var existing models.SavingsGoal
	if err := h.db.QueryRow(context.Background(),
		`SELECT id, user_id, account_id, name, image_url, target_amount, current_amount, start_date, deadline, status, created_at, updated_at
		 FROM savings_goals WHERE id = $1 AND user_id = $2`,
		id, userID,
	).Scan(&existing.ID, &existing.UserID, &existing.AccountID, &existing.Name, &existing.ImageURL, &existing.TargetAmount,
		&existing.CurrentAmount, &existing.StartDate, &existing.Deadline, &existing.Status, &existing.CreatedAt, &existing.UpdatedAt); err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "savings goal not found"})
		return
	}

	startDate := existing.StartDate
	if req.StartDate != nil && strings.TrimSpace(*req.StartDate) != "" {
		parsed, err := time.Parse("2006-01-02", *req.StartDate)
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid start_date format, use YYYY-MM-DD"})
			return
		}
		startDate = parsed
	}

	var deadline *time.Time
	if req.Deadline != nil {
		if strings.TrimSpace(*req.Deadline) != "" {
			parsed, err := time.Parse("2006-01-02", *req.Deadline)
			if err != nil {
				c.JSON(http.StatusBadRequest, gin.H{"error": "invalid deadline format, use YYYY-MM-DD"})
				return
			}
			deadline = &parsed
		}
	} else {
		deadline = existing.Deadline
	}
	if deadline != nil && deadline.Before(startDate) {
		c.JSON(http.StatusBadRequest, gin.H{"error": "วันที่สิ้นสุดต้องไม่ก่อนวันที่เริ่มต้น"})
		return
	}

	nextTarget := existing.TargetAmount
	if req.TargetAmount != nil {
		nextTarget = *req.TargetAmount
	}
	nextCurrent := existing.CurrentAmount
	if req.CurrentAmount != nil {
		nextCurrent = *req.CurrentAmount
	}
	nextStatus := existing.Status
	if req.Status != nil {
		nextStatus = *req.Status
	} else if existing.Status != models.GoalStatusCancelled {
		nextStatus = models.GoalStatusInProgress
		if nextCurrent >= nextTarget {
			nextStatus = models.GoalStatusCompleted
		}
	}

	var g models.SavingsGoal
	err := h.db.QueryRow(context.Background(),
		`UPDATE savings_goals
		 SET account_id     = COALESCE($1, account_id),
		     name           = COALESCE($2, name),
		     image_url      = $3,
		     target_amount  = COALESCE($4, target_amount),
		     current_amount = COALESCE($5, current_amount),
		     start_date     = $6,
		     deadline       = $7,
		     status         = $8
		 WHERE id = $9 AND user_id = $10
		 RETURNING id, user_id, account_id, name, image_url, target_amount, current_amount, start_date, deadline, status, created_at, updated_at`,
		req.AccountID, req.Name, req.ImageURL, req.TargetAmount, req.CurrentAmount, startDate, deadline, nextStatus, id, userID,
	).Scan(&g.ID, &g.UserID, &g.AccountID, &g.Name, &g.ImageURL, &g.TargetAmount,
		&g.CurrentAmount, &g.StartDate, &g.Deadline, &g.Status, &g.CreatedAt, &g.UpdatedAt)

	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "savings goal not found"})
		return
	}

	c.JSON(http.StatusOK, g)
}

func (h *SavingsGoalHandler) savingsGoalNameExists(ctx context.Context, userID, name, excludeID string) (bool, error) {
	var exists bool
	args := []any{userID, strings.ToLower(strings.TrimSpace(name))}
	query := `SELECT EXISTS(
		SELECT 1 FROM savings_goals
		WHERE user_id = $1 AND LOWER(name) = $2`
	if excludeID != "" {
		query += ` AND id <> $3`
		args = append(args, excludeID)
	}
	query += `)`
	err := h.db.QueryRow(ctx, query, args...).Scan(&exists)
	return exists, err
}

// DELETE /api/v1/savings-goals/:id
func (h *SavingsGoalHandler) Delete(c *gin.Context) {
	userID := c.GetString("user_id")
	id := c.Param("id")

	result, err := h.db.Exec(context.Background(),
		`DELETE FROM savings_goals WHERE id = $1 AND user_id = $2`,
		id, userID,
	)
	if err != nil || result.RowsAffected() == 0 {
		c.JSON(http.StatusNotFound, gin.H{"error": "savings goal not found"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"message": "savings goal deleted"})
}

// POST /api/v1/savings-goals/:id/initial-balance
// นับเงินที่มีอยู่แล้วในบัญชีเก็บออมเข้าเป้าหมาย โดยไม่สร้าง transaction และไม่เปลี่ยนยอดบัญชี
func (h *SavingsGoalHandler) AddInitialBalance(c *gin.Context) {
	userID := c.GetString("user_id")
	goalID := c.Param("id")

	var req struct {
		Amount float64 `json:"amount" binding:"required,gt=0"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	ctx := context.Background()

	var g models.SavingsGoal
	if err := h.db.QueryRow(ctx,
		`SELECT id, user_id, account_id, name, target_amount, current_amount, status
		 FROM savings_goals WHERE id = $1 AND user_id = $2`,
		goalID, userID,
	).Scan(&g.ID, &g.UserID, &g.AccountID, &g.Name, &g.TargetAmount, &g.CurrentAmount, &g.Status); err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "savings goal not found"})
		return
	}
	if g.Status != models.GoalStatusInProgress {
		c.JSON(http.StatusBadRequest, gin.H{"error": "เพิ่มยอดเริ่มต้นได้เฉพาะเป้าหมายที่กำลังออม"})
		return
	}
	if g.AccountID == nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "กรุณาผูกบัญชีเก็บออมก่อนเพิ่มยอดเริ่มต้น"})
		return
	}

	remaining := g.TargetAmount - g.CurrentAmount
	if remaining <= 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "เป้าหมายนี้ครบแล้ว"})
		return
	}
	if req.Amount > remaining {
		c.JSON(http.StatusBadRequest, gin.H{"error": "จำนวนเงินต้องไม่เกินยอดที่เหลือของเป้าหมาย"})
		return
	}

	var balance float64
	if err := h.db.QueryRow(ctx,
		`SELECT balance FROM accounts WHERE id=$1 AND user_id=$2 AND type='asset'`,
		*g.AccountID, userID,
	).Scan(&balance); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "ไม่พบบัญชีเก็บออม"})
		return
	}

	var allocated float64
	if err := h.db.QueryRow(ctx,
		`SELECT COALESCE(SUM(current_amount), 0)
		 FROM savings_goals
		 WHERE user_id=$1 AND account_id=$2 AND status <> 'cancelled'`,
		userID, *g.AccountID,
	).Scan(&allocated); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "ตรวจสอบยอดเงินของบัญชีไม่สำเร็จ"})
		return
	}

	available := balance - allocated
	if available <= 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "บัญชีนี้ไม่มีเงินเหลือให้นับเข้าเป้าหมาย"})
		return
	}
	if req.Amount > available {
		c.JSON(http.StatusBadRequest, gin.H{"error": "จำนวนเงินเกินยอดที่ยังนับเข้าเป้าหมายได้"})
		return
	}

	newAmount := g.CurrentAmount + req.Amount
	newStatus := models.GoalStatusInProgress
	if newAmount >= g.TargetAmount {
		newStatus = models.GoalStatusCompleted
	}

	var updated models.SavingsGoal
	if err := h.db.QueryRow(ctx,
		`UPDATE savings_goals
		 SET current_amount = $1, status = $2
		 WHERE id = $3 AND user_id = $4
		 RETURNING id, user_id, account_id, name, image_url, target_amount, current_amount, start_date, deadline, status, created_at, updated_at`,
		newAmount, newStatus, goalID, userID,
	).Scan(&updated.ID, &updated.UserID, &updated.AccountID, &updated.Name, &updated.ImageURL, &updated.TargetAmount,
		&updated.CurrentAmount, &updated.StartDate, &updated.Deadline, &updated.Status, &updated.CreatedAt, &updated.UpdatedAt); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to update goal"})
		return
	}

	c.JSON(http.StatusOK, updated)
}

// POST /api/v1/savings-goals/:id/deposit
// ฝากเงินเข้าเป้าหมาย — สร้าง transaction + อัปเดต balance + อัปเดต current_amount
func (h *SavingsGoalHandler) Deposit(c *gin.Context) {
	userID := c.GetString("user_id")
	goalID := c.Param("id")

	var req struct {
		FromAccountID string  `json:"from_account_id" binding:"required"`
		Amount        float64 `json:"amount"          binding:"required,gt=0"`
		Note          *string `json:"note"`
		Date          *string `json:"date"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	ctx := context.Background()

	// ดึงข้อมูลเป้าหมาย
	var g models.SavingsGoal
	err := h.db.QueryRow(ctx,
		`SELECT id, user_id, account_id, name, target_amount, current_amount, status
		 FROM savings_goals WHERE id = $1 AND user_id = $2`,
		goalID, userID,
	).Scan(&g.ID, &g.UserID, &g.AccountID, &g.Name, &g.TargetAmount, &g.CurrentAmount, &g.Status)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "savings goal not found"})
		return
	}
	if g.Status != "in_progress" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "ฝากเงินได้เฉพาะเป้าหมายที่กำลังออม"})
		return
	}
	if g.AccountID == nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "กรุณาผูกบัญชีเก็บออมก่อนฝากเงินเข้าเป้าหมาย"})
		return
	}

	// กำหนดวันที่
	txDate := time.Now()
	if req.Date != nil {
		if parsed, err := time.Parse("2006-01-02", *req.Date); err == nil {
			txDate = parsed
		}
	}

	// กำหนด note
	noteText := fmt.Sprintf("ออมเพื่อ: %s", g.Name)
	if req.Note != nil && *req.Note != "" {
		noteText = *req.Note
	}

	// เริ่ม DB transaction
	dbTx, err := h.db.Begin(ctx)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to begin transaction"})
		return
	}
	defer dbTx.Rollback(ctx)

	if req.FromAccountID == *g.AccountID {
		c.JSON(http.StatusBadRequest, gin.H{"error": "บัญชีต้นทางต้องไม่ใช่บัญชีเก็บออมของเป้าหมาย"})
		return
	}

	_, err = dbTx.Exec(ctx,
		`INSERT INTO transactions (user_id, account_id, to_account_id, type, amount, name, note, transaction_date)
		 VALUES ($1, $2, $3, 'transfer', $4, $5, $6, $7)`,
		userID, req.FromAccountID, *g.AccountID, req.Amount, g.Name, noteText, txDate,
	)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to create transaction"})
		return
	}
	err = debitAccount(ctx, dbTx, userID, req.FromAccountID, req.Amount)
	if err != nil {
		status := http.StatusInternalServerError
		if err == errInsufficientFunds || err == errAccountNotFound {
			status = http.StatusBadRequest
		}
		c.JSON(status, gin.H{"error": balanceErrorMessage(err)})
		return
	}
	err = creditAccount(ctx, dbTx, userID, *g.AccountID, req.Amount)
	if err != nil {
		status := http.StatusInternalServerError
		if err == errInsufficientFunds || err == errAccountNotFound {
			status = http.StatusBadRequest
		}
		c.JSON(status, gin.H{"error": balanceErrorMessage(err)})
		return
	}

	// อัปเดต current_amount และ status
	newAmount := g.CurrentAmount + req.Amount
	newStatus := string(g.Status)
	if newAmount >= g.TargetAmount {
		newStatus = "completed"
	}

	var updated models.SavingsGoal
	err = dbTx.QueryRow(ctx,
		`UPDATE savings_goals
		 SET current_amount = $1, status = $2
		 WHERE id = $3 AND user_id = $4
		 RETURNING id, user_id, account_id, name, image_url, target_amount, current_amount, start_date, deadline, status, created_at, updated_at`,
		newAmount, newStatus, goalID, userID,
	).Scan(&updated.ID, &updated.UserID, &updated.AccountID, &updated.Name, &updated.ImageURL, &updated.TargetAmount,
		&updated.CurrentAmount, &updated.StartDate, &updated.Deadline, &updated.Status, &updated.CreatedAt, &updated.UpdatedAt)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to update goal"})
		return
	}

	if err := dbTx.Commit(ctx); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to commit"})
		return
	}

	c.JSON(http.StatusOK, updated)
}
