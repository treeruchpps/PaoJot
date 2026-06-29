package notification

import (
	"context"
	"errors"
	"fmt"
	"strconv"
	"time"

	"paomoney/internal/recurring"
	"paomoney/internal/shared/ledger"
	"paomoney/internal/shared/types"

	"github.com/jackc/pgx/v5/pgxpool"
)

var (
	ErrNotificationNotFound = errors.New("notification not found")
	ErrRecurringNotFound    = errors.New("recurring not found")
)

type Repository struct {
	db *pgxpool.Pool
}

func NewRepository(db *pgxpool.Pool) *Repository {
	return &Repository{db: db}
}

func formatAmount(value float64) string {
	return strconv.FormatFloat(value, 'f', 2, 64)
}

func formatDate(t time.Time) string {
	return t.Format("2006-01-02")
}

func (r *Repository) EnsureSchema(ctx context.Context) error {
	_, err := r.db.Exec(ctx, `
		ALTER TABLE notifications ADD COLUMN IF NOT EXISTS goal_id UUID REFERENCES savings_goals(id) ON DELETE CASCADE;
		ALTER TABLE notifications ADD COLUMN IF NOT EXISTS notification_type VARCHAR(50) NOT NULL DEFAULT 'recurring';
		ALTER TABLE notifications ADD COLUMN IF NOT EXISTS reference_key VARCHAR(120);
		CREATE INDEX IF NOT EXISTS idx_notifications_type ON notifications(user_id, notification_type, created_at);
		CREATE UNIQUE INDEX IF NOT EXISTS idx_notifications_reference_key
			ON notifications(user_id, notification_type, reference_key)
			WHERE reference_key IS NOT NULL;
	`)
	return err
}

// ListLatest คืน notification 5 รายการล่าสุด (แม้อ่าน/จัดการแล้ว)
func (r *Repository) ListLatest(ctx context.Context, userID string) ([]Notification, error) {
	rows, err := r.db.Query(ctx,
		`SELECT id, user_id, recurring_id, budget_id, goal_id, notification_type,
		        title, message, is_read, action_taken, created_at
		 FROM notifications
		 WHERE user_id = $1
		 ORDER BY created_at DESC
		 LIMIT 5`,
		userID,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	list := []Notification{}
	for rows.Next() {
		var n Notification
		if err := rows.Scan(
			&n.ID, &n.UserID, &n.RecurringID, &n.BudgetID, &n.GoalID, &n.Type,
			&n.Title, &n.Message, &n.IsRead, &n.ActionTaken, &n.CreatedAt,
		); err != nil {
			continue
		}
		list = append(list, n)
	}
	return list, nil
}

func (r *Repository) GenerateRecurring(ctx context.Context, userID string, today time.Time) {
	rows, err := r.db.Query(ctx,
		`SELECT id, user_id, account_id, to_account_id, category_id, type, amount,
		        name, note, frequency, next_due_date, is_active
		 FROM recurring_transactions
		 WHERE user_id = $1 AND is_active = TRUE AND next_due_date <= $2`,
		userID, today,
	)
	if err != nil {
		return
	}
	defer rows.Close()
	for rows.Next() {
		var rec recurring.RecurringTransaction
		var nextDue time.Time
		if err := rows.Scan(
			&rec.ID, &rec.UserID, &rec.AccountID, &rec.ToAccountID, &rec.CategoryID,
			&rec.Type, &rec.Amount, &rec.Name, &rec.Note,
			&rec.Frequency,
			&nextDue, &rec.IsActive,
		); err != nil {
			continue
		}
		rec.NextDueDate = nextDue.Format("2006-01-02")

		var existCount int
		_ = r.db.QueryRow(ctx,
			`SELECT COUNT(*) FROM notifications
			 WHERE recurring_id = $1 AND action_taken = FALSE`,
			rec.ID,
		).Scan(&existCount)

		if existCount == 0 {
			title := recurring.BuildNotificationTitle(rec)
			msg := recurring.FrequencyLabel(rec.Frequency)
			r.db.Exec(ctx, //nolint
				`INSERT INTO notifications (user_id, recurring_id, notification_type, title, message)
				 VALUES ($1, $2, 'recurring', $3, $4)`,
				userID, rec.ID, title, msg,
			)
		}
	}
}

func (r *Repository) GenerateBudget(ctx context.Context, userID string) {
	r.db.Exec(ctx, `
		DELETE FROM notifications
		WHERE user_id = $1
		  AND action_taken = FALSE
		  AND is_read = FALSE
		  AND notification_type IN ('budget_near_limit', 'budget_over')
	`, userID) //nolint

	rows, err := r.db.Query(ctx, `
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
		r.insertOnceByRef(ctx, userID, notiType, "budget_id", id, title, message)
	}
}

func (r *Repository) GenerateGoal(ctx context.Context, userID string) {
	rows, err := r.db.Query(ctx, `
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
		msg := name + " · เหลืออีก ฿" + formatAmount(remaining) + " · ครบกำหนด " + formatDate(deadline)
		r.insertOnceByRef(ctx, userID, "goal_due", "goal_id", id, "เป้าหมายการออมใกล้ครบกำหนด", msg)
	}
}

func (r *Repository) GenerateAISummary(ctx context.Context, userID string) {
	var enabled bool
	var weekStart int
	if err := r.db.QueryRow(ctx,
		`SELECT ai_summary_enabled, week_start_day FROM user_profiles WHERE user_id = $1`,
		userID,
	).Scan(&enabled, &weekStart); err != nil || !enabled {
		return
	}
	if weekStart < 0 || weekStart > 6 {
		weekStart = 1
	}
	today := time.Now()
	weekStartDate := today.AddDate(0, 0, -((int(today.Weekday()) - weekStart + 7) % 7))

	prevWeekStart := weekStartDate.AddDate(0, 0, -7)
	prevWeekEnd := weekStartDate.AddDate(0, 0, -1)

	currWeekStart := weekStartDate
	currWeekEnd := weekStartDate.AddDate(0, 0, 6)

	monthStart := time.Date(today.Year(), today.Month(), 1, 0, 0, 0, 0, today.Location())
	prevMonthStart := monthStart.AddDate(0, -1, 0)
	prevMonthEnd := monthStart.AddDate(0, 0, -1)
	currMonthStart := monthStart
	currMonthEnd := monthStart.AddDate(0, 1, -1)

	// เกณฑ์เดียวกันทั้งรายสัปดาห์/รายเดือน: ต้องมีรายการ income+expense อย่างน้อย 10 รายการ
	// รอบที่จบแล้ว (เดิม)
	r.insertAISummaryIfEligible(ctx, userID, "ai_weekly", "สรุปการเงินรายสัปดาห์พร้อมแล้ว", prevWeekStart, prevWeekEnd, 10)
	r.insertAISummaryIfEligible(ctx, userID, "ai_monthly", "สรุปการเงินรายเดือนพร้อมแล้ว", prevMonthStart, prevMonthEnd, 10)
	// รอบปัจจุบัน — ยิง noti ทันทีที่ข้อมูลครบเกณฑ์ ให้ตรงกับปุ่มสร้างสรุปที่สว่างขึ้น
	// reference_key อิงช่วงวันที่ จึงไม่ชนกับรอบที่จบแล้ว และไม่สร้างซ้ำเมื่อรอบนี้กลายเป็นรอบก่อนหน้า
	r.insertAISummaryIfEligible(ctx, userID, "ai_weekly", "สรุปการเงินรายสัปดาห์พร้อมแล้ว", currWeekStart, currWeekEnd, 10)
	r.insertAISummaryIfEligible(ctx, userID, "ai_monthly", "สรุปการเงินรายเดือนพร้อมแล้ว", currMonthStart, currMonthEnd, 10)
}

func (r *Repository) insertAISummaryIfEligible(ctx context.Context, userID, notiType, title string, start, end time.Time, minCount int) {
	// ไม่บังคับว่าต้องเป็นวันแรกของสัปดาห์/เดือนพอดี — start/end ถูกคำนวณเป็นรอบ
	// สัปดาห์/เดือน "ก่อนหน้า" ที่จบไปแล้วอยู่แล้ว และมี reference_key กันสร้างซ้ำ
	// ดังนั้นเปิดแอปวันไหนของรอบปัจจุบันก็จะได้สรุปของรอบที่เพิ่งจบ (สร้างครั้งเดียว)

	var count, expenseCount int
	if err := r.db.QueryRow(ctx, `
		SELECT
			COUNT(*) FILTER (WHERE type IN ('income', 'expense')),
			COUNT(*) FILTER (WHERE type = 'expense')
		FROM transactions
		WHERE user_id = $1 AND type IN ('income', 'expense')
		  AND transaction_date >= $2 AND transaction_date <= $3
	`, userID, formatDate(start), formatDate(end)).Scan(&count, &expenseCount); err != nil || count < minCount || expenseCount == 0 {
		return
	}
	referenceKey := notiType + ":" + formatDate(start) + ":" + formatDate(end)
	var exists bool
	_ = r.db.QueryRow(ctx, `
		SELECT EXISTS (
			SELECT 1 FROM notifications
			WHERE user_id = $1 AND notification_type = $2 AND reference_key = $3
		)
	`, userID, notiType, referenceKey).Scan(&exists)
	if exists {
		return
	}
	msg := "มีข้อมูลเพียงพอสำหรับให้ AI ช่วยสรุปภาพรวม"
	msg = fmt.Sprintf("%s (%s - %s)", msg, formatDate(start), formatDate(end))
	r.db.Exec(ctx, //nolint
		`INSERT INTO notifications (user_id, notification_type, reference_key, title, message)
		 VALUES ($1, $2, $3, $4, $5)
		 ON CONFLICT DO NOTHING`,
		userID, notiType, referenceKey, title, msg,
	)
}

func (r *Repository) insertOnceByRef(ctx context.Context, userID, notiType, refColumn, refID, title, message string) {
	query := `SELECT EXISTS (
		SELECT 1 FROM notifications
		WHERE user_id = $1 AND notification_type = $2 AND ` + refColumn + ` = $3 AND action_taken = FALSE
	)`
	var exists bool
	_ = r.db.QueryRow(ctx, query, userID, notiType, refID).Scan(&exists)
	if exists {
		return
	}
	insert := `INSERT INTO notifications (user_id, ` + refColumn + `, notification_type, title, message)
		VALUES ($1, $2, $3, $4, $5)`
	r.db.Exec(ctx, insert, userID, refID, notiType, title, message) //nolint
}

func (r *Repository) Prune(ctx context.Context, userID string) {
	r.db.Exec(ctx, `DELETE FROM notifications
		WHERE user_id = $1
		  AND id NOT IN (
		    SELECT id FROM notifications
		    WHERE user_id = $1
		    ORDER BY created_at DESC
		    LIMIT 5
		  )`, userID) //nolint
}

// Confirm บันทึก transaction จริง + ปรับยอด + เลื่อน next_due + mark action_taken
func (r *Repository) Confirm(ctx context.Context, userID, notiID string) error {
	var recurringID *string
	err := r.db.QueryRow(ctx,
		`SELECT recurring_id FROM notifications WHERE id = $1 AND user_id = $2`,
		notiID, userID,
	).Scan(&recurringID)
	if err != nil || recurringID == nil {
		return ErrNotificationNotFound
	}

	var rec recurring.RecurringTransaction
	var nextDue time.Time
	err = r.db.QueryRow(ctx,
		`SELECT id, account_id, to_account_id, category_id, type, amount, name, note, frequency, next_due_date
		 FROM recurring_transactions WHERE id = $1 AND user_id = $2`,
		*recurringID, userID,
	).Scan(&rec.ID, &rec.AccountID, &rec.ToAccountID, &rec.CategoryID,
		&rec.Type, &rec.Amount, &rec.Name, &rec.Note, &rec.Frequency, &nextDue)
	if err != nil {
		return ErrRecurringNotFound
	}

	dbTx, err := r.db.Begin(ctx)
	if err != nil {
		return err
	}
	defer dbTx.Rollback(ctx)

	today := time.Now().Format("2006-01-02")

	_, err = dbTx.Exec(ctx,
		`INSERT INTO transactions
		   (user_id, account_id, to_account_id, category_id, type, amount, name, note, transaction_date, is_recurring)
		 VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9, TRUE)`,
		userID, rec.AccountID, rec.ToAccountID, rec.CategoryID,
		rec.Type, rec.Amount, rec.Name, rec.Note, today,
	)
	if err != nil {
		return err
	}

	switch types.TransactionType(rec.Type) {
	case types.TransactionTypeIncome:
		err = ledger.CreditAccount(ctx, dbTx, userID, rec.AccountID, rec.Amount)
	case types.TransactionTypeExpense:
		err = ledger.DebitAccount(ctx, dbTx, userID, rec.AccountID, rec.Amount)
	case types.TransactionTypeTransfer:
		if rec.ToAccountID != nil {
			err = ledger.DebitAccount(ctx, dbTx, userID, rec.AccountID, rec.Amount)
			if err == nil {
				err = ledger.CreditAccount(ctx, dbTx, userID, *rec.ToAccountID, rec.Amount)
			}
		}
	}
	if err != nil {
		return err
	}

	newNextDue := recurring.AdvanceNextDue(nextDue, rec.Frequency)
	_, err = dbTx.Exec(ctx,
		`UPDATE recurring_transactions SET next_due_date = $1 WHERE id = $2`,
		newNextDue, rec.ID)
	if err != nil {
		return err
	}

	_, err = dbTx.Exec(ctx,
		`UPDATE notifications SET is_read = TRUE, action_taken = TRUE WHERE id = $1`, notiID)
	if err != nil {
		return err
	}

	return dbTx.Commit(ctx)
}

// Skip เลื่อน next_due + mark action_taken
func (r *Repository) Skip(ctx context.Context, userID, notiID string) error {
	var recurringID *string
	err := r.db.QueryRow(ctx,
		`SELECT recurring_id FROM notifications WHERE id = $1 AND user_id = $2`, notiID, userID,
	).Scan(&recurringID)
	if err != nil {
		return ErrNotificationNotFound
	}

	if recurringID != nil {
		var nextDue time.Time
		var frequency string
		_ = r.db.QueryRow(ctx,
			`SELECT next_due_date, frequency FROM recurring_transactions WHERE id = $1`, *recurringID,
		).Scan(&nextDue, &frequency)

		newNextDue := recurring.AdvanceNextDue(nextDue, frequency)
		r.db.Exec(ctx, //nolint
			`UPDATE recurring_transactions SET next_due_date = $1 WHERE id = $2`,
			newNextDue, *recurringID)
	}

	r.db.Exec(ctx, //nolint
		`UPDATE notifications SET is_read = TRUE, action_taken = TRUE WHERE id = $1`, notiID)
	return nil
}

func (r *Repository) ReadAll(ctx context.Context, userID string) {
	r.db.Exec(ctx, //nolint
		`UPDATE notifications SET is_read = TRUE WHERE user_id = $1`, userID)
}
