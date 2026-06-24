// Package ledger เก็บ logic ปรับยอดเงินในบัญชี (credit/debit) ที่ใช้ร่วมกัน
// ระหว่าง transaction, savingsgoal, notification และ scan
package ledger

import (
	"context"
	"errors"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
)

var (
	ErrAccountNotFound   = errors.New("account not found")
	ErrInsufficientFunds = errors.New("insufficient funds")
)

// Execer คือสิ่งที่ Exec SQL ได้ (ทั้ง *pgxpool.Pool และ pgx.Tx)
type Execer interface {
	Exec(ctx context.Context, sql string, arguments ...any) (pgconn.CommandTag, error)
}

// CreditAccount เพิ่มยอดเงินเข้าบัญชี
func CreditAccount(ctx context.Context, execer Execer, userID, accountID string, amount float64) error {
	tag, err := execer.Exec(ctx,
		`UPDATE accounts
		 SET balance = balance + $1, updated_at = NOW()
		 WHERE id = $2 AND user_id = $3 AND is_active = true`,
		amount, accountID, userID,
	)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return ErrAccountNotFound
	}
	return nil
}

// DebitAccount ลดยอดเงินจากบัญชี (เช็คยอดพอ และเช็คว่ามีบัญชีจริง)
func DebitAccount(ctx context.Context, execer Execer, userID, accountID string, amount float64) error {
	tag, err := execer.Exec(ctx,
		`UPDATE accounts
		 SET balance = balance - $1, updated_at = NOW()
		 WHERE id = $2 AND user_id = $3 AND is_active = true AND balance >= $1`,
		amount, accountID, userID,
	)
	if err != nil {
		return err
	}
	if tag.RowsAffected() > 0 {
		return nil
	}

	var exists bool
	if checker, ok := execer.(interface {
		QueryRow(ctx context.Context, sql string, args ...any) pgx.Row
	}); ok {
		_ = checker.QueryRow(ctx,
			`SELECT EXISTS(SELECT 1 FROM accounts WHERE id = $1 AND user_id = $2 AND is_active = true)`,
			accountID, userID,
		).Scan(&exists)
	}
	if !exists {
		return ErrAccountNotFound
	}
	return ErrInsufficientFunds
}

// ErrorMessage แปลง error เป็นข้อความภาษาไทยสำหรับตอบ client
func ErrorMessage(err error) string {
	if errors.Is(err, ErrInsufficientFunds) {
		return "ยอดเงินในบัญชีไม่พอ"
	}
	if errors.Is(err, ErrAccountNotFound) {
		return "ไม่พบบัญชี"
	}
	return "failed to update account balance"
}
