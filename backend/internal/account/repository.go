package account

import (
	"context"
	"errors"

	"github.com/jackc/pgx/v5/pgxpool"
)

// ErrNotFound ใช้สื่อว่าไม่พบบัญชี (handler จะ map เป็น HTTP 404)
var ErrNotFound = errors.New("account not found")

// Repository เป็นชั้นที่คุยกับฐานข้อมูลโดยตรง — รวม SQL ของ account ไว้ที่เดียว
type Repository struct {
	db *pgxpool.Pool
}

func NewRepository(db *pgxpool.Pool) *Repository {
	return &Repository{db: db}
}

const accountColumns = `id, user_id, name, type, kind, balance, currency, is_active, created_at, updated_at`

func scanAccount(row interface {
	Scan(dest ...any) error
}) (Account, error) {
	var a Account
	err := row.Scan(&a.ID, &a.UserID, &a.Name, &a.Type, &a.Kind,
		&a.Balance, &a.Currency, &a.IsActive, &a.CreatedAt, &a.UpdatedAt)
	return a, err
}

// ListByUser คืนบัญชี asset ที่ยัง active ของผู้ใช้
func (r *Repository) ListByUser(ctx context.Context, userID string) ([]Account, error) {
	rows, err := r.db.Query(ctx,
		`SELECT `+accountColumns+`
		 FROM accounts
		 WHERE user_id = $1 AND is_active = true AND type = 'asset'
		 ORDER BY created_at ASC`,
		userID,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	accounts := []Account{}
	for rows.Next() {
		a, err := scanAccount(rows)
		if err != nil {
			continue
		}
		accounts = append(accounts, a)
	}
	return accounts, rows.Err()
}

// GetByID คืนบัญชีตาม id ของผู้ใช้ (ไม่พบ → ErrNotFound)
func (r *Repository) GetByID(ctx context.Context, id, userID string) (Account, error) {
	a, err := scanAccount(r.db.QueryRow(ctx,
		`SELECT `+accountColumns+` FROM accounts WHERE id = $1 AND user_id = $2`,
		id, userID,
	))
	if err != nil {
		return Account{}, ErrNotFound
	}
	return a, nil
}

// Create บันทึกบัญชีใหม่และคืนค่าที่สร้าง
func (r *Repository) Create(ctx context.Context, userID string, req CreateRequest) (Account, error) {
	return scanAccount(r.db.QueryRow(ctx,
		`INSERT INTO accounts (user_id, name, type, kind, balance, currency)
		 VALUES ($1, $2, $3, $4, $5, $6)
		 RETURNING `+accountColumns,
		userID, req.Name, req.Type, req.Kind, req.Balance, req.Currency,
	))
}

// Update แก้ไขบัญชี (COALESCE กับค่าที่ส่งมา) ไม่พบ → ErrNotFound
func (r *Repository) Update(ctx context.Context, id, userID string, req UpdateRequest) (Account, error) {
	a, err := scanAccount(r.db.QueryRow(ctx,
		`UPDATE accounts
		 SET name      = COALESCE($1, name),
		     kind      = COALESCE($2, kind),
		     currency  = COALESCE($3, currency),
		     is_active = COALESCE($4, is_active)
		 WHERE id = $5 AND user_id = $6
		 RETURNING `+accountColumns,
		req.Name, req.Kind, req.Currency, req.IsActive, id, userID,
	))
	if err != nil {
		return Account{}, ErrNotFound
	}
	return a, nil
}

// SoftDelete ปิดการใช้งานบัญชีพร้อมย้อนยอด/ลบธุรกรรมที่เกี่ยวข้องในทรานแซกชันเดียว
func (r *Repository) SoftDelete(ctx context.Context, id, userID string) error {
	dbTx, err := r.db.Begin(ctx)
	if err != nil {
		return err
	}
	defer dbTx.Rollback(ctx)

	var exists bool
	if err := dbTx.QueryRow(ctx,
		`SELECT EXISTS(SELECT 1 FROM accounts WHERE id = $1 AND user_id = $2 AND is_active = true)`,
		id, userID,
	).Scan(&exists); err != nil || !exists {
		return ErrNotFound
	}

	// ย้อนยอดปลายทางของรายการโอนที่บัญชีนี้เป็นต้นทาง
	if _, err := dbTx.Exec(ctx,
		`UPDATE accounts a
		 SET balance = a.balance - t.amount
		 FROM transactions t
		 WHERE t.user_id = $1 AND t.type = 'transfer'
		   AND t.account_id = $2 AND t.to_account_id = a.id
		   AND a.user_id = $1 AND a.id <> $2`,
		userID, id,
	); err != nil {
		return err
	}

	// ย้อนยอดต้นทางของรายการโอนที่บัญชีนี้เป็นปลายทาง
	if _, err := dbTx.Exec(ctx,
		`UPDATE accounts a
		 SET balance = a.balance + t.amount
		 FROM transactions t
		 WHERE t.user_id = $1 AND t.type = 'transfer'
		   AND t.to_account_id = $2 AND t.account_id = a.id
		   AND a.user_id = $1 AND a.id <> $2`,
		userID, id,
	); err != nil {
		return err
	}

	if _, err := dbTx.Exec(ctx,
		`DELETE FROM transactions
		 WHERE user_id = $1 AND (account_id = $2 OR to_account_id = $2)`,
		userID, id,
	); err != nil {
		return err
	}

	if _, err := dbTx.Exec(ctx,
		`DELETE FROM recurring_transactions
		 WHERE user_id = $1 AND (account_id = $2 OR to_account_id = $2)`,
		userID, id,
	); err != nil {
		return err
	}

	if _, err := dbTx.Exec(ctx,
		`DELETE FROM savings_goals WHERE user_id = $1 AND account_id = $2`,
		userID, id,
	); err != nil {
		return err
	}

	result, err := dbTx.Exec(ctx,
		`UPDATE accounts SET is_active = false WHERE id = $1 AND user_id = $2`,
		id, userID,
	)
	if err != nil || result.RowsAffected() == 0 {
		return ErrNotFound
	}

	return dbTx.Commit(ctx)
}
