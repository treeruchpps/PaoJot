package handlers

import (
	"context"
	"net/http"
	"paomoney/internal/models"
	"strconv"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5/pgxpool"
)

type NotificationHandler struct {
	db *pgxpool.Pool
}

func NewNotificationHandler(db *pgxpool.Pool) *NotificationHandler {
	h := &NotificationHandler{db: db}
	_ = h.ensureNotificationSchema(context.Background())
	return h
}

func (h *NotificationHandler) ensureNotificationSchema(ctx context.Context) error {
	_, err := h.db.Exec(ctx, `
		ALTER TABLE notifications ADD COLUMN IF NOT EXISTS goal_id UUID REFERENCES savings_goals(id) ON DELETE CASCADE;
		ALTER TABLE notifications ADD COLUMN IF NOT EXISTS notification_type VARCHAR(50) NOT NULL DEFAULT 'recurring';
		CREATE INDEX IF NOT EXISTS idx_notifications_type ON notifications(user_id, notification_type, created_at);
	`)
	return err
}

// GET /api/v1/notifications
// generate notifications จาก recurring ที่ครบกำหนด แล้วคืนทั้งหมดที่ยังไม่ action_taken
func (h *NotificationHandler) List(c *gin.Context) {
	userID := c.GetString("user_id")
	ctx := context.Background()
	today := time.Now().Truncate(24 * time.Hour)

	h.generateRecurringNotifications(ctx, userID, today)
	h.generateBudgetNotifications(ctx, userID)
	h.generateGoalNotifications(ctx, userID)
	h.generateAISummaryNotifications(ctx, userID)
	h.pruneNotifications(ctx, userID)

	// คืน notification 5 รายการล่าสุดเป็น log แม้อ่านแล้วหรือจัดการแล้ว
	nrows, err := h.db.Query(ctx,
		`SELECT id, user_id, recurring_id, budget_id, goal_id, notification_type,
		        title, message, is_read, action_taken, created_at
		 FROM notifications
		 WHERE user_id = $1
		 ORDER BY created_at DESC
		 LIMIT 5`,
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
			&n.ID, &n.UserID, &n.RecurringID, &n.BudgetID, &n.GoalID, &n.Type,
			&n.Title, &n.Message, &n.IsRead, &n.ActionTaken, &n.CreatedAt,
		); err != nil {
			continue
		}
		list = append(list, n)
	}

	c.JSON(http.StatusOK, list)
}

func (h *NotificationHandler) generateRecurringNotifications(ctx context.Context, userID string, today time.Time) {
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
					`INSERT INTO notifications (user_id, recurring_id, notification_type, title, message)
					 VALUES ($1, $2, 'recurring', $3, $4)`,
					userID, r.ID, title, msg,
				)
			}
		}
	}
}

func (h *NotificationHandler) generateBudgetNotifications(ctx context.Context, userID string) {
	h.db.Exec(ctx, `
		DELETE FROM notifications
		WHERE user_id = $1
		  AND action_taken = FALSE
		  AND is_read = FALSE
		  AND notification_type IN ('budget_near_limit', 'budget_over')
	`, userID) //nolint

	rows, err := h.db.Query(ctx, `
		SELECT b.id, COALESCE(c.name, 'งบประมาณ') AS category_name, b.amount,
		       COALESCE(SUM(t.amount), 0) AS spent
		FROM budgets b
		LEFT JOIN categories c ON c.id = b.category_id
		LEFT JOIN transactions t ON t.user_id = b.user_id
			AND t.type = 'expense'
			AND t.category_id = b.category_id
			AND t.transaction_date >= b.start_date
			AND t.transaction_date <= b.end_date
		WHERE b.user_id = $1 AND b.is_active = TRUE AND b.end_date >= CURRENT_DATE
		GROUP BY b.id, c.name, b.amount
	`, userID)
	if err != nil {
		return
	}
	defer rows.Close()

	for rows.Next() {
		var id, name string
		var amount, spent float64
		if err := rows.Scan(&id, &name, &amount, &spent); err != nil || amount <= 0 {
			continue
		}
		notiType := ""
		title := ""
		message := ""
		if spent >= amount {
			notiType = "budget_over"
			title = "งบประมาณใช้ครบแล้ว"
			message = name
		} else if spent/amount >= 0.8 {
			notiType = "budget_near_limit"
			title = "งบประมาณใกล้เต็ม"
			message = name
		}
		if notiType == "" {
			continue
		}
		h.insertOnceByRef(ctx, userID, notiType, "budget_id", id, title, message)
	}
}

func (h *NotificationHandler) generateGoalNotifications(ctx context.Context, userID string) {
	rows, err := h.db.Query(ctx, `
		SELECT id, name, target_amount - current_amount AS remaining, deadline
		FROM savings_goals
		WHERE user_id = $1
		  AND status = 'in_progress'
		  AND deadline IS NOT NULL
		  AND deadline >= CURRENT_DATE
		  AND deadline <= CURRENT_DATE + INTERVAL '7 days'
		  AND current_amount < target_amount
	`, userID)
	if err != nil {
		return
	}
	defer rows.Close()

	for rows.Next() {
		var id, name string
		var remaining float64
		var deadline time.Time
		if err := rows.Scan(&id, &name, &remaining, &deadline); err != nil {
			continue
		}
		msg := name + " · เหลืออีก ฿" + formatAmount(remaining) + " · ครบกำหนด " + budgetDateString(deadline)
		h.insertOnceByRef(ctx, userID, "goal_due", "goal_id", id, "เป้าหมายการออมใกล้ครบกำหนด", msg)
	}
}

func formatAmount(value float64) string {
	return strconv.FormatFloat(value, 'f', 2, 64)
}

func (h *NotificationHandler) generateAISummaryNotifications(ctx context.Context, userID string) {
	var enabled bool
	var weekStart int
	if err := h.db.QueryRow(ctx,
		`SELECT ai_summary_enabled, week_start_day FROM user_profiles WHERE user_id = $1`,
		userID,
	).Scan(&enabled, &weekStart); err != nil || !enabled {
		return
	}
	today := time.Now()
	weekStartDate := today.AddDate(0, 0, -((int(today.Weekday()) - weekStart + 7) % 7))
	weekEndDate := weekStartDate.AddDate(0, 0, 6)
	monthStart := time.Date(today.Year(), today.Month(), 1, 0, 0, 0, 0, today.Location())
	monthEnd := monthStart.AddDate(0, 1, -1)
	h.insertAISummaryIfEligible(ctx, userID, "ai_weekly", "สรุปการเงินรายสัปดาห์พร้อมแล้ว", weekStartDate, weekEndDate, 11)
	h.insertAISummaryIfEligible(ctx, userID, "ai_monthly", "สรุปการเงินรายเดือนพร้อมแล้ว", monthStart, monthEnd, 31)
}

func (h *NotificationHandler) insertAISummaryIfEligible(ctx context.Context, userID, notiType, title string, start, end time.Time, minCount int) {
	var count int
	if err := h.db.QueryRow(ctx, `
		SELECT COUNT(*) FROM transactions
		WHERE user_id = $1 AND type IN ('income', 'expense')
		  AND transaction_date >= $2 AND transaction_date <= $3
	`, userID, budgetDateString(start), budgetDateString(end)).Scan(&count); err != nil || count < minCount {
		return
	}
	var exists bool
	_ = h.db.QueryRow(ctx, `
		SELECT EXISTS (
			SELECT 1 FROM notifications
			WHERE user_id = $1 AND notification_type = $2 AND action_taken = FALSE
		)
	`, userID, notiType).Scan(&exists)
	if exists {
		return
	}
	msg := "มีข้อมูลเพียงพอสำหรับให้ AI ช่วยสรุปภาพรวม"
	h.db.Exec(ctx, //nolint
		`INSERT INTO notifications (user_id, notification_type, title, message)
		 VALUES ($1, $2, $3, $4)`,
		userID, notiType, title, msg,
	)
}

func (h *NotificationHandler) insertOnceByRef(ctx context.Context, userID, notiType, refColumn, refID, title, message string) {
	query := `SELECT EXISTS (
		SELECT 1 FROM notifications
		WHERE user_id = $1 AND notification_type = $2 AND ` + refColumn + ` = $3 AND action_taken = FALSE
	)`
	var exists bool
	_ = h.db.QueryRow(ctx, query, userID, notiType, refID).Scan(&exists)
	if exists {
		return
	}
	insert := `INSERT INTO notifications (user_id, ` + refColumn + `, notification_type, title, message)
		VALUES ($1, $2, $3, $4, $5)`
	h.db.Exec(ctx, insert, userID, refID, notiType, title, message) //nolint
}

func (h *NotificationHandler) pruneNotifications(ctx context.Context, userID string) {
	h.db.Exec(ctx, `DELETE FROM notifications
		WHERE user_id = $1
		  AND id NOT IN (
		    SELECT id FROM notifications
		    WHERE user_id = $1
		    ORDER BY created_at DESC
		    LIMIT 5
		  )`, userID) //nolint
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
		err = creditAccount(ctx, dbTx, userID, r.AccountID, r.Amount)
	case models.TransactionTypeExpense:
		err = debitAccount(ctx, dbTx, userID, r.AccountID, r.Amount)
	case models.TransactionTypeTransfer:
		if r.ToAccountID != nil {
			err = debitAccount(ctx, dbTx, userID, r.AccountID, r.Amount)
			if err == nil {
				err = creditAccount(ctx, dbTx, userID, *r.ToAccountID, r.Amount)
			}
		}
	}
	if err != nil {
		status := http.StatusInternalServerError
		if err == errInsufficientFunds || err == errAccountNotFound {
			status = http.StatusBadRequest
		}
		c.JSON(status, gin.H{"error": balanceErrorMessage(err)})
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
		`UPDATE notifications SET is_read = TRUE WHERE user_id = $1`, userID)
	c.JSON(http.StatusOK, gin.H{"message": "ok"})
}
