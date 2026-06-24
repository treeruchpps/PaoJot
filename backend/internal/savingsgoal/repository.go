package savingsgoal

import (
	"context"
	"fmt"
	"strings"
	"time"

	"paomoney/internal/shared/ledger"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

type Repository struct {
	db *pgxpool.Pool
}

func NewRepository(db *pgxpool.Pool) *Repository {
	return &Repository{db: db}
}

const goalColumns = `id, user_id, account_id, name, image_url, target_amount, current_amount, start_date, deadline, status, created_at, updated_at`

func scanGoal(row pgx.Row) (SavingsGoal, error) {
	var g SavingsGoal
	err := row.Scan(&g.ID, &g.UserID, &g.AccountID, &g.Name, &g.ImageURL, &g.TargetAmount,
		&g.CurrentAmount, &g.StartDate, &g.Deadline, &g.Status, &g.CreatedAt, &g.UpdatedAt)
	return g, err
}

func (r *Repository) EnsureSchema() {
	ctx := context.Background()
	_, _ = r.db.Exec(ctx, `
		ALTER TABLE savings_goals
		ADD COLUMN IF NOT EXISTS start_date DATE NOT NULL DEFAULT CURRENT_DATE;
	`)
	_, _ = r.db.Exec(ctx, `ALTER TYPE transaction_type ADD VALUE IF NOT EXISTS 'goal_deposit'`)
	_, _ = r.db.Exec(ctx, `ALTER TYPE transaction_type ADD VALUE IF NOT EXISTS 'goal_withdrawal'`)
}

func (r *Repository) nameExists(ctx context.Context, userID, name, excludeID string) (bool, error) {
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
	err := r.db.QueryRow(ctx, query, args...).Scan(&exists)
	return exists, err
}

func (r *Repository) List(ctx context.Context, userID string) ([]SavingsGoal, error) {
	rows, err := r.db.Query(ctx,
		`SELECT `+goalColumns+`
		 FROM savings_goals WHERE user_id = $1 ORDER BY created_at DESC`,
		userID,
	)
	if err != nil {
		return nil, internal("failed to fetch savings goals")
	}
	defer rows.Close()

	goals := []SavingsGoal{}
	for rows.Next() {
		g, err := scanGoal(rows)
		if err != nil {
			continue
		}
		goals = append(goals, g)
	}
	return goals, nil
}

func (r *Repository) GetByID(ctx context.Context, id, userID string) (SavingsGoal, error) {
	g, err := scanGoal(r.db.QueryRow(ctx,
		`SELECT `+goalColumns+` FROM savings_goals WHERE id = $1 AND user_id = $2`,
		id, userID,
	))
	if err != nil {
		return SavingsGoal{}, notFound("savings goal not found")
	}
	return g, nil
}

func (r *Repository) Create(ctx context.Context, userID string, req CreateRequest) (SavingsGoal, error) {
	req.Name = strings.TrimSpace(req.Name)
	if req.Name == "" {
		return SavingsGoal{}, badRequest("กรุณากรอกชื่อเป้าหมาย")
	}
	nameExists, err := r.nameExists(ctx, userID, req.Name, "")
	if err != nil {
		return SavingsGoal{}, internal("failed to validate savings goal name")
	}
	if nameExists {
		return SavingsGoal{}, badRequest("มีเป้าหมายชื่อนี้อยู่แล้ว")
	}

	startDate := time.Now()
	if req.StartDate != nil && strings.TrimSpace(*req.StartDate) != "" {
		parsed, err := time.Parse("2006-01-02", *req.StartDate)
		if err != nil {
			return SavingsGoal{}, badRequest("invalid start_date format, use YYYY-MM-DD")
		}
		startDate = parsed
	}

	var deadline *time.Time
	if req.Deadline != nil && strings.TrimSpace(*req.Deadline) != "" {
		parsed, err := time.Parse("2006-01-02", *req.Deadline)
		if err != nil {
			return SavingsGoal{}, badRequest("invalid deadline format, use YYYY-MM-DD")
		}
		if parsed.Before(startDate) {
			return SavingsGoal{}, badRequest("วันที่สิ้นสุดต้องไม่ก่อนวันที่เริ่มต้น")
		}
		deadline = &parsed
	}

	dbTx, err := r.db.Begin(ctx)
	if err != nil {
		return SavingsGoal{}, internal("failed to begin transaction")
	}
	defer dbTx.Rollback(ctx)

	var accountID string
	var isActive bool
	err = dbTx.QueryRow(ctx,
		`SELECT id, is_active FROM accounts WHERE user_id = $1 AND name = 'บัญชีเป้าหมายการออม' AND type = 'asset' LIMIT 1`,
		userID,
	).Scan(&accountID, &isActive)
	if err != nil {
		if err == pgx.ErrNoRows {
			err = dbTx.QueryRow(ctx,
				`INSERT INTO accounts (user_id, name, type, kind, balance, currency)
				 VALUES ($1, 'บัญชีเป้าหมายการออม', 'asset', 'savings_goal', 0.00, 'THB')
				 RETURNING id`,
				userID,
			).Scan(&accountID)
			if err != nil {
				return SavingsGoal{}, internal("failed to create associated account")
			}
		} else {
			return SavingsGoal{}, internal("failed to check associated account")
		}
	} else if !isActive {
		_, err = dbTx.Exec(ctx, `UPDATE accounts SET is_active = true WHERE id = $1`, accountID)
		if err != nil {
			return SavingsGoal{}, internal("failed to reactivate associated account")
		}
	}

	g, err := scanGoal(dbTx.QueryRow(ctx,
		`INSERT INTO savings_goals (user_id, account_id, name, image_url, target_amount, current_amount, start_date, deadline, status)
		 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
		 RETURNING `+goalColumns,
		userID, accountID, req.Name, req.ImageURL, req.TargetAmount, 0, startDate, deadline, GoalStatusInProgress,
	))
	if err != nil {
		return SavingsGoal{}, internal("failed to create savings goal")
	}

	if err := dbTx.Commit(ctx); err != nil {
		return SavingsGoal{}, internal("failed to commit transaction")
	}
	return g, nil
}

func (r *Repository) Update(ctx context.Context, id, userID string, req UpdateRequest) (SavingsGoal, error) {
	if req.Name != nil {
		name := strings.TrimSpace(*req.Name)
		if name == "" {
			return SavingsGoal{}, badRequest("กรุณากรอกชื่อเป้าหมาย")
		}
		nameExists, err := r.nameExists(ctx, userID, name, id)
		if err != nil {
			return SavingsGoal{}, internal("failed to validate savings goal name")
		}
		if nameExists {
			return SavingsGoal{}, badRequest("มีเป้าหมายชื่อนี้อยู่แล้ว")
		}
		req.Name = &name
	}

	tx, err := r.db.Begin(ctx)
	if err != nil {
		return SavingsGoal{}, internal("failed to begin transaction")
	}
	defer tx.Rollback(ctx)

	existing, err := scanGoal(tx.QueryRow(ctx,
		`SELECT `+goalColumns+` FROM savings_goals WHERE id = $1 AND user_id = $2`,
		id, userID,
	))
	if err != nil {
		return SavingsGoal{}, notFound("savings goal not found")
	}

	startDate := existing.StartDate
	if req.StartDate != nil && strings.TrimSpace(*req.StartDate) != "" {
		parsed, err := time.Parse("2006-01-02", *req.StartDate)
		if err != nil {
			return SavingsGoal{}, badRequest("invalid start_date format, use YYYY-MM-DD")
		}
		startDate = parsed
	}

	var deadline *time.Time
	if req.Deadline != nil {
		if strings.TrimSpace(*req.Deadline) != "" {
			parsed, err := time.Parse("2006-01-02", *req.Deadline)
			if err != nil {
				return SavingsGoal{}, badRequest("invalid deadline format, use YYYY-MM-DD")
			}
			deadline = &parsed
		}
	} else {
		deadline = existing.Deadline
	}
	if deadline != nil && deadline.Before(startDate) {
		return SavingsGoal{}, badRequest("วันที่สิ้นสุดต้องไม่ก่อนวันที่เริ่มต้น")
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
	} else if existing.Status != GoalStatusCancelled {
		nextStatus = GoalStatusInProgress
		if nextCurrent >= nextTarget {
			nextStatus = GoalStatusCompleted
		}
	}

	g, err := scanGoal(tx.QueryRow(ctx,
		`UPDATE savings_goals
		 SET name           = COALESCE($1, name),
		     image_url      = $2,
		     target_amount  = COALESCE($3, target_amount),
		     current_amount = COALESCE($4, current_amount),
		     start_date     = $5,
		     deadline       = $6,
		     status         = $7
		 WHERE id = $8 AND user_id = $9
		 RETURNING `+goalColumns,
		req.Name, req.ImageURL, req.TargetAmount, req.CurrentAmount, startDate, deadline, nextStatus, id, userID,
	))
	if err != nil {
		return SavingsGoal{}, notFound("savings goal not found")
	}

	if err := tx.Commit(ctx); err != nil {
		return SavingsGoal{}, internal("failed to commit transaction")
	}
	return g, nil
}

func (r *Repository) Delete(ctx context.Context, id, userID, refundAccountID string) error {
	var g SavingsGoal
	err := r.db.QueryRow(ctx,
		`SELECT id, user_id, account_id, name, target_amount, current_amount, status
		 FROM savings_goals WHERE id = $1 AND user_id = $2`,
		id, userID,
	).Scan(&g.ID, &g.UserID, &g.AccountID, &g.Name, &g.TargetAmount, &g.CurrentAmount, &g.Status)
	if err != nil {
		return notFound("savings goal not found")
	}

	dbTx, err := r.db.Begin(ctx)
	if err != nil {
		return internal("failed to begin transaction")
	}
	defer dbTx.Rollback(ctx)

	if g.CurrentAmount > 0 && g.AccountID != nil && refundAccountID != "" {
		var refundAccExists bool
		err = dbTx.QueryRow(ctx,
			`SELECT EXISTS(SELECT 1 FROM accounts WHERE id = $1 AND user_id = $2 AND is_active = true AND type = 'asset')`,
			refundAccountID, userID,
		).Scan(&refundAccExists)
		if err != nil || !refundAccExists {
			return badRequest("ไม่พบบัญชีปลายทางที่จะรับเงินคืน")
		}

		_, err = dbTx.Exec(ctx,
			`INSERT INTO transactions (user_id, account_id, to_account_id, type, amount, name, note, transaction_date)
			 VALUES ($1, $2, $3, 'goal_withdrawal', $4, $5, $6, CURRENT_DATE)`,
			userID, *g.AccountID, refundAccountID, g.CurrentAmount, fmt.Sprintf("คืนเงินจากเป้าหมาย: %s", g.Name), fmt.Sprintf("ลบเป้าหมายการออม: %s", g.Name),
		)
		if err != nil {
			return internal("failed to create refund transaction")
		}

		if err = ledger.DebitAccount(ctx, dbTx, userID, *g.AccountID, g.CurrentAmount); err != nil {
			return internal("failed to debit saving goal account")
		}
		if err = ledger.CreditAccount(ctx, dbTx, userID, refundAccountID, g.CurrentAmount); err != nil {
			return internal("failed to credit refund account")
		}
	}

	if g.AccountID != nil {
		var otherGoalsCount int
		err = dbTx.QueryRow(ctx,
			`SELECT COUNT(*) FROM savings_goals WHERE user_id = $1 AND id <> $2`,
			userID, id,
		).Scan(&otherGoalsCount)
		if err != nil {
			return internal("failed to check other savings goals")
		}

		if otherGoalsCount == 0 {
			_, err = dbTx.Exec(ctx,
				`UPDATE accounts SET is_active = false WHERE id = $1 AND user_id = $2`,
				*g.AccountID, userID,
			)
			if err != nil {
				return internal("failed to deactivate associated account")
			}
		}
	}

	result, err := dbTx.Exec(ctx,
		`DELETE FROM savings_goals WHERE id = $1 AND user_id = $2`,
		id, userID,
	)
	if err != nil || result.RowsAffected() == 0 {
		return notFound("savings goal not found")
	}

	if err := dbTx.Commit(ctx); err != nil {
		return internal("failed to commit transaction")
	}
	return nil
}

func (r *Repository) AddInitialBalance(ctx context.Context, userID, goalID string, amount float64) (SavingsGoal, error) {
	var g SavingsGoal
	if err := r.db.QueryRow(ctx,
		`SELECT id, user_id, account_id, name, target_amount, current_amount, status
		 FROM savings_goals WHERE id = $1 AND user_id = $2`,
		goalID, userID,
	).Scan(&g.ID, &g.UserID, &g.AccountID, &g.Name, &g.TargetAmount, &g.CurrentAmount, &g.Status); err != nil {
		return SavingsGoal{}, notFound("savings goal not found")
	}
	if g.Status != GoalStatusInProgress {
		return SavingsGoal{}, badRequest("เพิ่มยอดเริ่มต้นได้เฉพาะเป้าหมายที่กำลังออม")
	}
	if g.AccountID == nil {
		return SavingsGoal{}, badRequest("กรุณาผูกบัญชีเก็บออมก่อนเพิ่มยอดเริ่มต้น")
	}

	remaining := g.TargetAmount - g.CurrentAmount
	if remaining <= 0 {
		return SavingsGoal{}, badRequest("เป้าหมายนี้ครบแล้ว")
	}
	if amount > remaining {
		return SavingsGoal{}, badRequest("จำนวนเงินต้องไม่เกินยอดที่เหลือของเป้าหมาย")
	}

	var balance float64
	if err := r.db.QueryRow(ctx,
		`SELECT balance FROM accounts WHERE id=$1 AND user_id=$2 AND type='asset'`,
		*g.AccountID, userID,
	).Scan(&balance); err != nil {
		return SavingsGoal{}, badRequest("ไม่พบบัญชีเก็บออม")
	}

	var allocated float64
	if err := r.db.QueryRow(ctx,
		`SELECT COALESCE(SUM(current_amount), 0)
		 FROM savings_goals
		 WHERE user_id=$1 AND account_id=$2 AND status <> 'cancelled'`,
		userID, *g.AccountID,
	).Scan(&allocated); err != nil {
		return SavingsGoal{}, internal("ตรวจสอบยอดเงินของบัญชีไม่สำเร็จ")
	}

	available := balance - allocated
	if available <= 0 {
		return SavingsGoal{}, badRequest("บัญชีนี้ไม่มีเงินเหลือให้นับเข้าเป้าหมาย")
	}
	if amount > available {
		return SavingsGoal{}, badRequest("จำนวนเงินเกินยอดที่ยังนับเข้าเป้าหมายได้")
	}

	newAmount := g.CurrentAmount + amount
	newStatus := GoalStatusInProgress
	if newAmount >= g.TargetAmount {
		newStatus = GoalStatusCompleted
	}

	updated, err := scanGoal(r.db.QueryRow(ctx,
		`UPDATE savings_goals
		 SET current_amount = $1, status = $2
		 WHERE id = $3 AND user_id = $4
		 RETURNING `+goalColumns,
		newAmount, newStatus, goalID, userID,
	))
	if err != nil {
		return SavingsGoal{}, internal("failed to update goal")
	}
	return updated, nil
}

func (r *Repository) Deposit(ctx context.Context, userID, goalID string, req DepositRequest) (SavingsGoal, error) {
	var g SavingsGoal
	err := r.db.QueryRow(ctx,
		`SELECT id, user_id, account_id, name, target_amount, current_amount, status
		 FROM savings_goals WHERE id = $1 AND user_id = $2`,
		goalID, userID,
	).Scan(&g.ID, &g.UserID, &g.AccountID, &g.Name, &g.TargetAmount, &g.CurrentAmount, &g.Status)
	if err != nil {
		return SavingsGoal{}, notFound("savings goal not found")
	}
	if g.Status != GoalStatusInProgress {
		return SavingsGoal{}, badRequest("ฝากเงินได้เฉพาะเป้าหมายที่กำลังออม")
	}
	if g.AccountID == nil {
		return SavingsGoal{}, badRequest("กรุณาผูกบัญชีเก็บออมก่อนฝากเงินเข้าเป้าหมาย")
	}

	txDate := time.Now()
	if req.Date != nil {
		if parsed, err := time.Parse("2006-01-02", *req.Date); err == nil {
			txDate = parsed
		}
	}

	noteText := fmt.Sprintf("ออมเพื่อ: %s", g.Name)
	if req.Note != nil && *req.Note != "" {
		noteText = *req.Note
	}

	dbTx, err := r.db.Begin(ctx)
	if err != nil {
		return SavingsGoal{}, internal("failed to begin transaction")
	}
	defer dbTx.Rollback(ctx)

	if req.FromAccountID == *g.AccountID {
		return SavingsGoal{}, badRequest("บัญชีต้นทางต้องไม่ใช่บัญชีเก็บออมของเป้าหมาย")
	}

	_, err = dbTx.Exec(ctx,
		`INSERT INTO transactions (user_id, account_id, to_account_id, type, amount, name, note, transaction_date)
		 VALUES ($1, $2, $3, 'goal_deposit', $4, $5, $6, $7)`,
		userID, req.FromAccountID, *g.AccountID, req.Amount, g.Name, noteText, txDate,
	)
	if err != nil {
		return SavingsGoal{}, internal("failed to create transaction")
	}
	if err = ledger.DebitAccount(ctx, dbTx, userID, req.FromAccountID, req.Amount); err != nil {
		return SavingsGoal{}, balanceError(err)
	}
	if err = ledger.CreditAccount(ctx, dbTx, userID, *g.AccountID, req.Amount); err != nil {
		return SavingsGoal{}, balanceError(err)
	}

	newAmount := g.CurrentAmount + req.Amount
	newStatus := string(g.Status)
	if newAmount >= g.TargetAmount {
		newStatus = "completed"
	}

	updated, err := scanGoal(dbTx.QueryRow(ctx,
		`UPDATE savings_goals
		 SET current_amount = $1, status = $2
		 WHERE id = $3 AND user_id = $4
		 RETURNING `+goalColumns,
		newAmount, newStatus, goalID, userID,
	))
	if err != nil {
		return SavingsGoal{}, internal("failed to update goal")
	}

	if err := dbTx.Commit(ctx); err != nil {
		return SavingsGoal{}, internal("failed to commit")
	}
	return updated, nil
}

func (r *Repository) Withdraw(ctx context.Context, userID, goalID string, req WithdrawRequest) (SavingsGoal, error) {
	var g SavingsGoal
	err := r.db.QueryRow(ctx,
		`SELECT id, user_id, account_id, name, target_amount, current_amount, status
		 FROM savings_goals WHERE id = $1 AND user_id = $2`,
		goalID, userID,
	).Scan(&g.ID, &g.UserID, &g.AccountID, &g.Name, &g.TargetAmount, &g.CurrentAmount, &g.Status)
	if err != nil {
		return SavingsGoal{}, notFound("savings goal not found")
	}
	if g.AccountID == nil {
		return SavingsGoal{}, badRequest("เป้าหมายนี้ไม่มีบัญชีเก็บออม")
	}
	if req.ToAccountID == *g.AccountID {
		return SavingsGoal{}, badRequest("บัญชีปลายทางต้องไม่ใช่บัญชีเก็บออมของเป้าหมาย")
	}
	if req.Amount > g.CurrentAmount {
		return SavingsGoal{}, badRequest(fmt.Sprintf("ถอนได้สูงสุด ฿%.2f (ยอดออมปัจจุบัน)", g.CurrentAmount))
	}

	txDate := time.Now()
	if req.Date != nil {
		if parsed, err := time.Parse("2006-01-02", *req.Date); err == nil {
			txDate = parsed
		}
	}
	noteText := fmt.Sprintf("ถอนจากเป้าหมาย: %s", g.Name)
	if req.Note != nil && *req.Note != "" {
		noteText = *req.Note
	}

	dbTx, err := r.db.Begin(ctx)
	if err != nil {
		return SavingsGoal{}, internal("failed to begin transaction")
	}
	defer dbTx.Rollback(ctx)

	_, err = dbTx.Exec(ctx,
		`INSERT INTO transactions (user_id, account_id, to_account_id, type, amount, name, note, transaction_date)
		 VALUES ($1, $2, $3, 'goal_withdrawal', $4, $5, $6, $7)`,
		userID, *g.AccountID, req.ToAccountID, req.Amount, g.Name, noteText, txDate,
	)
	if err != nil {
		return SavingsGoal{}, internal("failed to create transaction")
	}

	if err = ledger.DebitAccount(ctx, dbTx, userID, *g.AccountID, req.Amount); err != nil {
		return SavingsGoal{}, balanceError(err)
	}
	if err = ledger.CreditAccount(ctx, dbTx, userID, req.ToAccountID, req.Amount); err != nil {
		return SavingsGoal{}, balanceError(err)
	}

	newAmount := g.CurrentAmount - req.Amount
	newStatus := string(g.Status)
	if newAmount < g.TargetAmount && newStatus == "completed" {
		newStatus = "in_progress"
	}

	updated, err := scanGoal(dbTx.QueryRow(ctx,
		`UPDATE savings_goals
		 SET current_amount = $1, status = $2
		 WHERE id = $3 AND user_id = $4
		 RETURNING `+goalColumns,
		newAmount, newStatus, goalID, userID,
	))
	if err != nil {
		return SavingsGoal{}, internal("failed to update goal")
	}

	if err := dbTx.Commit(ctx); err != nil {
		return SavingsGoal{}, internal("failed to commit")
	}
	return updated, nil
}
