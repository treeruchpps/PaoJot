package handlers

import (
	"context"
	"fmt"
	"net/http"
	"paomoney/internal/models"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5/pgxpool"
)

type RecurringHandler struct {
	db *pgxpool.Pool
}

func NewRecurringHandler(db *pgxpool.Pool) *RecurringHandler {
	return &RecurringHandler{db: db}
}

// GET /api/v1/recurring
func (h *RecurringHandler) List(c *gin.Context) {
	userID := c.GetString("user_id")

	rows, err := h.db.Query(context.Background(),
		`SELECT id, user_id, account_id, to_account_id, category_id, type, amount,
		        name, note, frequency, next_due_date,
		        is_active, created_at, updated_at
		 FROM recurring_transactions
		 WHERE user_id = $1
		 ORDER BY created_at DESC`,
		userID,
	)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to fetch recurring"})
		return
	}
	defer rows.Close()

	list := []models.RecurringTransaction{}
	for rows.Next() {
		var r models.RecurringTransaction
		var nextDue time.Time
		if err := rows.Scan(
			&r.ID, &r.UserID, &r.AccountID, &r.ToAccountID, &r.CategoryID,
			&r.Type, &r.Amount, &r.Name, &r.Note,
			&r.Frequency,
			&nextDue, &r.IsActive, &r.CreatedAt, &r.UpdatedAt,
		); err != nil {
			continue
		}
		r.NextDueDate = nextDue.Format("2006-01-02")
		list = append(list, r)
	}

	c.JSON(http.StatusOK, list)
}

// POST /api/v1/recurring
func (h *RecurringHandler) Create(c *gin.Context) {
	userID := c.GetString("user_id")

	var req models.CreateRecurringRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	nextDue, err := time.Parse("2006-01-02", req.NextDueDate)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid next_due_date format"})
		return
	}

	var r models.RecurringTransaction
	var nextDueOut time.Time
	err = h.db.QueryRow(context.Background(),
		`INSERT INTO recurring_transactions
		   (user_id, account_id, to_account_id, category_id, type, amount,
		    name, note, frequency, next_due_date)
		 VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
		 RETURNING id, user_id, account_id, to_account_id, category_id, type, amount,
		           name, note, frequency, next_due_date,
		           is_active, created_at, updated_at`,
		userID, req.AccountID, req.ToAccountID, req.CategoryID, req.Type, req.Amount,
		req.Name, req.Note, req.Frequency, nextDue,
	).Scan(
		&r.ID, &r.UserID, &r.AccountID, &r.ToAccountID, &r.CategoryID,
		&r.Type, &r.Amount, &r.Name, &r.Note,
		&r.Frequency,
		&nextDueOut, &r.IsActive, &r.CreatedAt, &r.UpdatedAt,
	)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to create recurring"})
		return
	}
	r.NextDueDate = nextDueOut.Format("2006-01-02")
	c.JSON(http.StatusCreated, r)
}

// PUT /api/v1/recurring/:id
func (h *RecurringHandler) Update(c *gin.Context) {
	userID := c.GetString("user_id")
	id := c.Param("id")

	var req models.UpdateRecurringRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	var nextDuePtr *time.Time
	if req.NextDueDate != nil {
		t, err := time.Parse("2006-01-02", *req.NextDueDate)
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid next_due_date format"})
			return
		}
		nextDuePtr = &t
	}

	var r models.RecurringTransaction
	var nextDueOut time.Time
	err := h.db.QueryRow(context.Background(),
		`UPDATE recurring_transactions
		 SET category_id  = COALESCE($1, category_id),
		     amount       = COALESCE($2, amount),
		     name         = COALESCE($3, name),
		     note         = COALESCE($4, note),
		     frequency    = COALESCE($5, frequency),
		     next_due_date= COALESCE($6, next_due_date),
		     is_active    = COALESCE($7, is_active)
		 WHERE id = $8 AND user_id = $9
		 RETURNING id, user_id, account_id, to_account_id, category_id, type, amount,
		           name, note, frequency, next_due_date,
		           is_active, created_at, updated_at`,
		req.CategoryID, req.Amount, req.Name, req.Note,
		req.Frequency, nextDuePtr, req.IsActive, id, userID,
	).Scan(
		&r.ID, &r.UserID, &r.AccountID, &r.ToAccountID, &r.CategoryID,
		&r.Type, &r.Amount, &r.Name, &r.Note,
		&r.Frequency,
		&nextDueOut, &r.IsActive, &r.CreatedAt, &r.UpdatedAt,
	)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "recurring not found"})
		return
	}
	r.NextDueDate = nextDueOut.Format("2006-01-02")
	c.JSON(http.StatusOK, r)
}

// DELETE /api/v1/recurring/:id
func (h *RecurringHandler) Delete(c *gin.Context) {
	userID := c.GetString("user_id")
	id := c.Param("id")

	result, err := h.db.Exec(context.Background(),
		`DELETE FROM recurring_transactions WHERE id = $1 AND user_id = $2`, id, userID,
	)
	if err != nil || result.RowsAffected() == 0 {
		c.JSON(http.StatusNotFound, gin.H{"error": "recurring not found"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"message": "deleted"})
}

// ── คำนวณ next_due_date ถัดไปจาก frequency ────────────────────────────────
func advanceNextDue(current time.Time, frequency string) time.Time {
	switch frequency {
	case "daily":
		return current.AddDate(0, 0, 1)
	case "weekly":
		return current.AddDate(0, 0, 7)
	case "yearly":
		return current.AddDate(1, 0, 0)
	default: // monthly
		return current.AddDate(0, 1, 0)
	}
}

// FrequencyLabel แปลง enum เป็นภาษาไทย
func FrequencyLabel(f string) string {
	switch f {
	case "daily":
		return "ทุกวัน"
	case "weekly":
		return "ทุกสัปดาห์"
	case "yearly":
		return "ทุกปี"
	default:
		return "ทุกเดือน"
	}
}

// BuildNotificationTitle สร้าง title สำหรับ notification
func BuildNotificationTitle(r models.RecurringTransaction) string {
	name := "รายการประจำ"
	if r.Name != nil && *r.Name != "" {
		name = *r.Name
	}
	return fmt.Sprintf("%s ครบกำหนดวันนี้ (฿%.0f)", name, r.Amount)
}
