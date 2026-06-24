package transaction

import (
	"context"
	"errors"
	"strconv"
	"time"

	"paomoney/internal/shared/ledger"
	"paomoney/internal/shared/types"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

var ErrNotFound = errors.New("transaction not found")

type Repository struct {
	db *pgxpool.Pool
}

func NewRepository(db *pgxpool.Pool) *Repository {
	return &Repository{db: db}
}

// List คืนรายการธุรกรรม + สถิติ (count/income/expense) ตามตัวกรองและการแบ่งหน้า
func (r *Repository) List(ctx context.Context, userID string, p ListParams) ([]Transaction, int, float64, float64, error) {
	where := ` WHERE user_id = $1`
	args := []interface{}{userID}
	idx := 2

	if p.AccountID != "" {
		where += " AND account_id = $" + strconv.Itoa(idx)
		args = append(args, p.AccountID)
		idx++
	}
	if p.Type != "" {
		where += " AND type::text = $" + strconv.Itoa(idx)
		args = append(args, p.Type)
		idx++
	} else if !p.IncludeGoal {
		where += " AND type::text NOT IN ('goal_deposit','goal_withdrawal')"
	}
	if p.DateFrom != "" {
		where += " AND transaction_date >= $" + strconv.Itoa(idx)
		args = append(args, p.DateFrom)
		idx++
	}
	if p.DateTo != "" {
		where += " AND transaction_date <= $" + strconv.Itoa(idx)
		args = append(args, p.DateTo)
		idx++
	}
	if p.Search != "" {
		where += " AND (COALESCE(name, '') ILIKE $" + strconv.Itoa(idx) +
			" OR COALESCE(note, '') ILIKE $" + strconv.Itoa(idx) +
			" OR amount::text ILIKE $" + strconv.Itoa(idx) + ")"
		args = append(args, "%"+p.Search+"%")
		idx++
	}

	var total int
	var totalIncome, totalExpense float64
	statsQuery := `SELECT COUNT(*),
		COALESCE(SUM(CASE WHEN type = 'income' THEN amount ELSE 0 END), 0),
		COALESCE(SUM(CASE WHEN type = 'expense' THEN amount ELSE 0 END), 0)
		FROM transactions` + where
	if err := r.db.QueryRow(ctx, statsQuery, args...).Scan(&total, &totalIncome, &totalExpense); err != nil {
		return nil, 0, 0, 0, err
	}

	orderBy := "transaction_date DESC, created_at DESC"
	switch p.SortBy {
	case "amount":
		orderBy = "amount " + p.SortDir + ", transaction_date DESC, created_at DESC"
	case "name":
		orderBy = "COALESCE(name, '') " + p.SortDir + ", transaction_date DESC, created_at DESC"
	case "type":
		orderBy = "type " + p.SortDir + ", transaction_date DESC, created_at DESC"
	case "date":
		orderBy = "transaction_date " + p.SortDir + ", created_at " + p.SortDir
	}

	offset := (p.Page - 1) * p.Limit
	query := `SELECT id, user_id, account_id, to_account_id, category_id, type, amount, name, note, transaction_date, is_recurring, created_at, updated_at
			  FROM transactions` + where
	query += " ORDER BY " + orderBy
	query += " LIMIT $" + strconv.Itoa(idx) + " OFFSET $" + strconv.Itoa(idx+1)
	args = append(args, p.Limit, offset)

	rows, err := r.db.Query(ctx, query, args...)
	if err != nil {
		return nil, 0, 0, 0, err
	}
	defer rows.Close()

	transactions := []Transaction{}
	for rows.Next() {
		var t Transaction
		if err := rows.Scan(&t.ID, &t.UserID, &t.AccountID, &t.ToAccountID, &t.CategoryID,
			&t.Type, &t.Amount, &t.Name, &t.Note, &t.TransactionDate, &t.IsRecurring, &t.CreatedAt, &t.UpdatedAt); err != nil {
			continue
		}
		transactions = append(transactions, t)
	}

	return transactions, total, totalIncome, totalExpense, nil
}

func (r *Repository) GetByID(ctx context.Context, id, userID string) (Transaction, error) {
	var t Transaction
	err := r.db.QueryRow(ctx,
		`SELECT id, user_id, account_id, to_account_id, category_id, type, amount, name, note, transaction_date, is_recurring, created_at, updated_at
		 FROM transactions WHERE id = $1 AND user_id = $2`,
		id, userID,
	).Scan(&t.ID, &t.UserID, &t.AccountID, &t.ToAccountID, &t.CategoryID,
		&t.Type, &t.Amount, &t.Name, &t.Note, &t.TransactionDate, &t.IsRecurring, &t.CreatedAt, &t.UpdatedAt)
	if err != nil {
		return Transaction{}, ErrNotFound
	}
	return t, nil
}

// Create แทรกธุรกรรมและปรับยอดบัญชีในทรานแซกชันเดียว
func (r *Repository) Create(ctx context.Context, userID string, req CreateRequest, txDate time.Time) (Transaction, error) {
	dbTx, err := r.db.Begin(ctx)
	if err != nil {
		return Transaction{}, err
	}
	defer dbTx.Rollback(ctx)

	var t Transaction
	err = dbTx.QueryRow(ctx,
		`INSERT INTO transactions (user_id, account_id, to_account_id, category_id, type, amount, name, note, transaction_date, is_recurring)
		 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, FALSE)
		 RETURNING id, user_id, account_id, to_account_id, category_id, type, amount, name, note, transaction_date, is_recurring, created_at, updated_at`,
		userID, req.AccountID, req.ToAccountID, req.CategoryID, req.Type, req.Amount, req.Name, req.Note, txDate,
	).Scan(&t.ID, &t.UserID, &t.AccountID, &t.ToAccountID, &t.CategoryID,
		&t.Type, &t.Amount, &t.Name, &t.Note, &t.TransactionDate, &t.IsRecurring, &t.CreatedAt, &t.UpdatedAt)
	if err != nil {
		return Transaction{}, err
	}

	switch req.Type {
	case types.TransactionTypeIncome:
		err = ledger.CreditAccount(ctx, dbTx, userID, req.AccountID, req.Amount)
	case types.TransactionTypeExpense:
		err = ledger.DebitAccount(ctx, dbTx, userID, req.AccountID, req.Amount)
	case types.TransactionTypeTransfer:
		err = ledger.DebitAccount(ctx, dbTx, userID, req.AccountID, req.Amount)
		if err == nil && req.ToAccountID != nil {
			err = ledger.CreditAccount(ctx, dbTx, userID, *req.ToAccountID, req.Amount)
		}
	case types.TransactionTypeAdjustment:
		// ปรับยอด: ไม่เปลี่ยน balance
	}
	if err != nil {
		return Transaction{}, err
	}

	if err := dbTx.Commit(ctx); err != nil {
		return Transaction{}, err
	}
	return t, nil
}

// Update ย้อนยอดเดิม → แก้ row → ปรับยอดใหม่ ในทรานแซกชันเดียว
func (r *Repository) Update(ctx context.Context, id, userID string, req UpdateRequest, txDate *time.Time) (Transaction, error) {
	var old Transaction
	err := r.db.QueryRow(ctx,
		`SELECT id, user_id, account_id, to_account_id, type, amount FROM transactions WHERE id = $1 AND user_id = $2`,
		id, userID,
	).Scan(&old.ID, &old.UserID, &old.AccountID, &old.ToAccountID, &old.Type, &old.Amount)
	if err != nil {
		return Transaction{}, ErrNotFound
	}
	if old.Type == types.TransactionTypeTransfer && old.ToAccountID != nil && *old.ToAccountID == old.AccountID {
		return Transaction{}, ErrSameAccount
	}

	dbTx, err := r.db.Begin(ctx)
	if err != nil {
		return Transaction{}, err
	}
	defer dbTx.Rollback(ctx)

	// ย้อนยอดเดิม
	switch old.Type {
	case types.TransactionTypeIncome:
		err = ledger.DebitAccount(ctx, dbTx, userID, old.AccountID, old.Amount)
	case types.TransactionTypeExpense:
		err = ledger.CreditAccount(ctx, dbTx, userID, old.AccountID, old.Amount)
	case types.TransactionTypeTransfer:
		if old.ToAccountID != nil {
			err = ledger.CreditAccount(ctx, dbTx, userID, old.AccountID, old.Amount)
			if err == nil {
				err = ledger.DebitAccount(ctx, dbTx, userID, *old.ToAccountID, old.Amount)
			}
			if err == nil {
				err = reverseSavingsGoalDeposit(ctx, dbTx, userID, *old.ToAccountID, old.Amount)
			}
		}
	case types.TransactionTypeAdjustment:
	}
	if err != nil {
		return Transaction{}, err
	}

	var t Transaction
	err = dbTx.QueryRow(ctx,
		`UPDATE transactions
		 SET account_id       = COALESCE($1, account_id),
		     to_account_id    = CASE WHEN COALESCE($2, type) = 'transfer' THEN COALESCE($3, to_account_id) ELSE NULL END,
		     category_id      = COALESCE($4, category_id),
		     type             = COALESCE($2, type),
		     amount           = COALESCE($5, amount),
		     name             = COALESCE($6, name),
		     note             = COALESCE($7, note),
		     transaction_date = COALESCE($8, transaction_date)
		 WHERE id = $9 AND user_id = $10
		 RETURNING id, user_id, account_id, to_account_id, category_id, type, amount, name, note, transaction_date, is_recurring, created_at, updated_at`,
		req.AccountID, req.Type, req.ToAccountID, req.CategoryID, req.Amount, req.Name, req.Note, txDate, id, userID,
	).Scan(&t.ID, &t.UserID, &t.AccountID, &t.ToAccountID, &t.CategoryID,
		&t.Type, &t.Amount, &t.Name, &t.Note, &t.TransactionDate, &t.IsRecurring, &t.CreatedAt, &t.UpdatedAt)
	if err != nil {
		return Transaction{}, err
	}

	// ปรับยอดใหม่
	switch t.Type {
	case types.TransactionTypeIncome:
		err = ledger.CreditAccount(ctx, dbTx, userID, t.AccountID, t.Amount)
	case types.TransactionTypeExpense:
		err = ledger.DebitAccount(ctx, dbTx, userID, t.AccountID, t.Amount)
	case types.TransactionTypeTransfer:
		if t.ToAccountID != nil {
			err = ledger.DebitAccount(ctx, dbTx, userID, t.AccountID, t.Amount)
			if err == nil {
				err = ledger.CreditAccount(ctx, dbTx, userID, *t.ToAccountID, t.Amount)
			}
			if err == nil {
				err = applySavingsGoalDeposit(ctx, dbTx, userID, *t.ToAccountID, t.Amount)
			}
		}
	case types.TransactionTypeAdjustment:
	}
	if err != nil {
		return Transaction{}, err
	}

	if err := dbTx.Commit(ctx); err != nil {
		return Transaction{}, err
	}
	return t, nil
}

// Delete ลบธุรกรรมพร้อมย้อนยอดบัญชีกลับ
func (r *Repository) Delete(ctx context.Context, id, userID string) error {
	var t Transaction
	err := r.db.QueryRow(ctx,
		`SELECT id, user_id, account_id, to_account_id, type, amount FROM transactions WHERE id = $1 AND user_id = $2`,
		id, userID,
	).Scan(&t.ID, &t.UserID, &t.AccountID, &t.ToAccountID, &t.Type, &t.Amount)
	if err != nil {
		return ErrNotFound
	}

	dbTx, err := r.db.Begin(ctx)
	if err != nil {
		return err
	}
	defer dbTx.Rollback(ctx)

	result, err := dbTx.Exec(ctx, `DELETE FROM transactions WHERE id = $1 AND user_id = $2`, id, userID)
	if err != nil || result.RowsAffected() == 0 {
		return ErrNotFound
	}

	switch t.Type {
	case types.TransactionTypeIncome:
		err = ledger.DebitAccount(ctx, dbTx, userID, t.AccountID, t.Amount)
	case types.TransactionTypeExpense:
		err = ledger.CreditAccount(ctx, dbTx, userID, t.AccountID, t.Amount)
	case types.TransactionTypeTransfer:
		if t.ToAccountID != nil {
			err = ledger.CreditAccount(ctx, dbTx, userID, t.AccountID, t.Amount)
			if err == nil {
				err = ledger.DebitAccount(ctx, dbTx, userID, *t.ToAccountID, t.Amount)
			}
			if err == nil {
				err = reverseSavingsGoalDeposit(ctx, dbTx, userID, *t.ToAccountID, t.Amount)
			}
		}
	case types.TransactionTypeAdjustment:
	}
	if err != nil {
		return err
	}

	return dbTx.Commit(ctx)
}

func reverseSavingsGoalDeposit(ctx context.Context, dbTx pgx.Tx, userID, goalAccountID string, amount float64) error {
	_, err := dbTx.Exec(ctx, `
		UPDATE savings_goals
		SET current_amount = GREATEST(current_amount - $3, 0),
		    status = CASE
		      WHEN status = 'cancelled' THEN status
		      WHEN GREATEST(current_amount - $3, 0) >= target_amount THEN 'completed'::goal_status
		      ELSE 'in_progress'::goal_status
		    END
		WHERE user_id = $1
		  AND account_id = $2
		  AND status <> 'cancelled'`,
		userID, goalAccountID, amount,
	)
	return err
}

func applySavingsGoalDeposit(ctx context.Context, dbTx pgx.Tx, userID, goalAccountID string, amount float64) error {
	_, err := dbTx.Exec(ctx, `
		UPDATE savings_goals
		SET current_amount = current_amount + $3,
		    status = CASE
		      WHEN status = 'cancelled' THEN status
		      WHEN current_amount + $3 >= target_amount THEN 'completed'::goal_status
		      ELSE 'in_progress'::goal_status
		    END
		WHERE user_id = $1
		  AND account_id = $2
		  AND status <> 'cancelled'`,
		userID, goalAccountID, amount,
	)
	return err
}
