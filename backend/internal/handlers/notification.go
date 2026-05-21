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

type NotificationHandler struct {
	db *pgxpool.Pool
}

func NewNotificationHandler(db *pgxpool.Pool) *NotificationHandler {
	return &NotificationHandler{db: db}
}

// GET /api/v1/notifications
// generate notifications จาก recurring ที่ครบกำหนด แล้วคืนทั้งหมดที่ยังไม่ action_taken
func (h *NotificationHandler) List(c *gin.Context) {
	userID := c.GetString("user_id")
	ctx := context.Background()
	today := time.Now().Truncate(24 * time.Hour)

	// 1. ดึง recurring ที่ active และ next_due_date <= วันนี้
	rows, err := h.db.Query(ctx,
		`SELECT id, user_id, account_id, to_account_id, category_id, type, amount,
		        name, note, frequency, day_of_month, day_of_week, next_due_date, is_active
		 FROM recurring_transactions
		 WHERE user_id = $1 AND is_active = TRUE AND next_due_date <= $2`,
		userID, today,
	)
	if err == nil {
		defer rows.Close()
		for rows.Next() {
			var r models.RecurringTransaction
			var nextDue time.Time
			if err := rows.Scan(
				&r.ID, &r.UserID, &r.AccountID, &r.ToAccountID, &r.CategoryID,
				&r.Type, &r.Amount, &r.Name, &r.Note,
				&r.Frequency, &r.DayOfMonth, &r.DayOfWeek,
				&nextDue, &r.IsActive,
			); err != nil {
				continue
			}
			r.NextDueDate = nextDue.Format("2006-01-02")

			// 2. สร้าง notification ถ้ายังไม่มีของวันนี้
			var existCount int
			_ = h.db.QueryRow(ctx,
				`SELECT COUNT(*) FROM notifications
				 WHERE recurring_id = $1 AND action_taken = FALSE`,
				r.ID,
			).Scan(&existCount)

			if existCount == 0 {
				title := BuildNotificationTitle(r)
				msg := FrequencyLabel(r.Frequency)
				h.db.Exec(ctx, //nolint
					`INSERT INTO notifications (user_id, recurring_id, title, message)
					 VALUES ($1, $2, $3, $4)`,
					userID, r.ID, title, msg,
				)
			}
		}
	}

	// 3. ตรวจงบประมาณที่เกิน → สร้าง notification ถ้ายังไม่มี
	budgetRows, err2 := h.db.Query(ctx,
		`SELECT b.id, b.name, b.amount, b.period,
		        COALESCE((
		          SELECT SUM(t.amount)
		          FROM transactions t
		          WHERE t.user_id = b.user_id
		            AND t.type = 'expense'
		            AND (b.category_id IS NULL OR t.category_id = b.category_id)
		            AND t.transaction_date >= CASE b.period
		              WHEN 'monthly' THEN date_trunc('month', CURRENT_DATE)::date
		              WHEN 'weekly'  THEN date_trunc('week',  CURRENT_DATE)::date
		              WHEN 'yearly'  THEN date_trunc('year',  CURRENT_DATE)::date
		            END
		            AND t.transaction_date <= CASE b.period
		              WHEN 'monthly' THEN (date_trunc('month', CURRENT_DATE) + interval '1 month - 1 day')::date
		              WHEN 'weekly'  THEN (date_trunc('week',  CURRENT_DATE) + interval '6 days')::date
		              WHEN 'yearly'  THEN (date_trunc('year',  CURRENT_DATE) + interval '1 year - 1 day')::date
		            END
		        ), 0) AS spent
		 FROM budgets b
		 WHERE b.user_id = $1`,
		userID,
	)
	if err2 == nil {
		defer budgetRows.Close()
		for budgetRows.Next() {
			var budgetID, budgetName, period string
			var budgetAmount, spent float64
			if err := budgetRows.Scan(&budgetID, &budgetName, &budgetAmount, &period, &spent); err != nil {
				continue
			}
			if spent <= budgetAmount {
				continue // ยังไม่เกิน
			}
			// ตรวจว่ามี notification budget นี้ที่ยังไม่ dismiss อยู่แล้วไหม
			var existCount int
			_ = h.db.QueryRow(ctx,
				`SELECT COUNT(*) FROM notifications
				 WHERE budget_id = $1 AND action_taken = FALSE`,
				budgetID,
			).Scan(&existCount)
			if existCount == 0 {
				title := fmt.Sprintf("เกินงบประมาณ: %s", budgetName)
				msg := fmt.Sprintf("ใช้ไปแล้ว ฿%.0f จากงบ ฿%.0f (เกิน ฿%.0f)", spent, budgetAmount, spent-budgetAmount)
				h.db.Exec(ctx, //nolint
					`INSERT INTO notifications (user_id, budget_id, title, message)
					 VALUES ($1, $2, $3, $4)`,
					userID, budgetID, title, msg,
				)
			}
		}
	}

	// 4. คืน notification ทั้งหมดที่ยังไม่ action_taken (เรียงใหม่ก่อน)
	nrows, err := h.db.Query(ctx,
		`SELECT id, user_id, recurring_id, budget_id, title, message, is_read, action_taken, created_at
		 FROM notifications
		 WHERE user_id = $1 AND action_taken = FALSE
		 ORDER BY created_at DESC`,
		userID,
	)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to fetch notifications"})
		return
	}
	defer nrows.Close()

	list := []models.Notification{}
	for nrows.Next() {
		var n models.Notification
		if err := nrows.Scan(
			&n.ID, &n.UserID, &n.RecurringID, &n.BudgetID, &n.Title, &n.Message,
			&n.IsRead, &n.ActionTaken, &n.CreatedAt,
		); err != nil {
			continue
		}
		list = append(list, n)
	}

	c.JSON(http.StatusOK, list)
}

// POST /api/v1/notifications/:id/confirm
// บันทึก transaction จริง + เลื่อน next_due_date + mark action_taken
func (h *NotificationHandler) Confirm(c *gin.Context) {
	userID := c.GetString("user_id")
	nid := c.Param("id")
	ctx := context.Background()

	// ดึง notification + recurring
	var n models.Notification
	err := h.db.QueryRow(ctx,
		`SELECT id, user_id, recurring_id FROM notifications WHERE id = $1 AND user_id = $2`,
		nid, userID,
	).Scan(&n.ID, &n.UserID, &n.RecurringID)
	if err != nil || n.RecurringID == nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "notification not found"})
		return
	}

	var r models.RecurringTransaction
	var nextDue time.Time
	err = h.db.QueryRow(ctx,
		`SELECT id, account_id, to_account_id, category_id, type, amount, name, note, frequency, next_due_date
		 FROM recurring_transactions WHERE id = $1 AND user_id = $2`,
		*n.RecurringID, userID,
	).Scan(&r.ID, &r.AccountID, &r.ToAccountID, &r.CategoryID,
		&r.Type, &r.Amount, &r.Name, &r.Note, &r.Frequency, &nextDue)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "recurring not found"})
		return
	}

	// เริ่ม DB transaction
	dbTx, err := h.db.Begin(ctx)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to begin tx"})
		return
	}
	defer dbTx.Rollback(ctx)

	today := time.Now().Format("2006-01-02")

	// สร้าง transaction จริง (is_recurring = TRUE เพื่อแสดง badge ในหน้ารายการ)
	_, err = dbTx.Exec(ctx,
		`INSERT INTO transactions
		   (user_id, account_id, to_account_id, category_id, type, amount, name, note, transaction_date, is_recurring)
		 VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9, TRUE)`,
		userID, r.AccountID, r.ToAccountID, r.CategoryID,
		r.Type, r.Amount, r.Name, r.Note, today,
	)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to create transaction"})
		return
	}

	// อัปเดต balance ตามประเภท
	txType := models.TransactionType(r.Type)
	switch txType {
	case models.TransactionTypeIncome:
		_, err = dbTx.Exec(ctx,
			`UPDATE accounts SET balance = balance + $1 WHERE id = $2 AND user_id = $3`,
			r.Amount, r.AccountID, userID)
	case models.TransactionTypeExpense:
		_, err = dbTx.Exec(ctx,
			`UPDATE accounts SET balance = balance - $1 WHERE id = $2 AND user_id = $3`,
			r.Amount, r.AccountID, userID)
	case models.TransactionTypeTransfer:
		if r.ToAccountID != nil {
			_, err = dbTx.Exec(ctx,
				`UPDATE accounts SET balance = balance - $1 WHERE id = $2 AND user_id = $3`,
				r.Amount, r.AccountID, userID)
			if err == nil {
				var toType string
				dbTx.QueryRow(ctx,
					`SELECT type FROM accounts WHERE id = $1`, *r.ToAccountID).Scan(&toType)
				if toType == "liability" {
					_, err = dbTx.Exec(ctx,
						`UPDATE accounts SET balance = balance - $1 WHERE id = $2 AND user_id = $3`,
						r.Amount, *r.ToAccountID, userID)
				} else {
					_, err = dbTx.Exec(ctx,
						`UPDATE accounts SET balance = balance + $1 WHERE id = $2 AND user_id = $3`,
						r.Amount, *r.ToAccountID, userID)
				}
			}
		}
	}
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to update balance"})
		return
	}

	// เลื่อน next_due_date
	newNextDue := advanceNextDue(nextDue, r.Frequency)
	_, err = dbTx.Exec(ctx,
		`UPDATE recurring_transactions SET next_due_date = $1 WHERE id = $2`,
		newNextDue, r.ID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to advance due date"})
		return
	}

	// mark notification
	_, err = dbTx.Exec(ctx,
		`UPDATE notifications SET is_read = TRUE, action_taken = TRUE WHERE id = $1`, nid)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to update notification"})
		return
	}

	if err := dbTx.Commit(ctx); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to commit"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"message": "confirmed"})
}

// POST /api/v1/notifications/:id/skip
// ข้าม → เลื่อน next_due_date + mark action_taken
func (h *NotificationHandler) Skip(c *gin.Context) {
	userID := c.GetString("user_id")
	nid := c.Param("id")
	ctx := context.Background()

	var recurringID *string
	err := h.db.QueryRow(ctx,
		`SELECT recurring_id FROM notifications WHERE id = $1 AND user_id = $2`, nid, userID,
	).Scan(&recurringID)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "notification not found"})
		return
	}

	if recurringID != nil {
		var nextDue time.Time
		var frequency string
		_ = h.db.QueryRow(ctx,
			`SELECT next_due_date, frequency FROM recurring_transactions WHERE id = $1`, *recurringID,
		).Scan(&nextDue, &frequency)

		newNextDue := advanceNextDue(nextDue, frequency)
		h.db.Exec(ctx, //nolint
			`UPDATE recurring_transactions SET next_due_date = $1 WHERE id = $2`,
			newNextDue, *recurringID)
	}

	h.db.Exec(ctx, //nolint
		`UPDATE notifications SET is_read = TRUE, action_taken = TRUE WHERE id = $1`, nid)

	c.JSON(http.StatusOK, gin.H{"message": "skipped"})
}

// PUT /api/v1/notifications/read-all
func (h *NotificationHandler) ReadAll(c *gin.Context) {
	userID := c.GetString("user_id")
	h.db.Exec(context.Background(),
		`UPDATE notifications SET is_read = TRUE WHERE user_id = $1 AND action_taken = FALSE`, userID)
	c.JSON(http.StatusOK, gin.H{"message": "ok"})
}
