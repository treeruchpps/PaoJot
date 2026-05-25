package handlers

import (
	"context"
	"errors"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
)

var (
	errAccountNotFound   = errors.New("account not found")
	errInsufficientFunds = errors.New("insufficient funds")
)

type balanceExecer interface {
	Exec(ctx context.Context, sql string, arguments ...any) (pgconn.CommandTag, error)
}

func creditAccount(ctx context.Context, execer balanceExecer, userID, accountID string, amount float64) error {
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
		return errAccountNotFound
	}
	return nil
}

func debitAccount(ctx context.Context, execer balanceExecer, userID, accountID string, amount float64) error {
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
		return errAccountNotFound
	}
	return errInsufficientFunds
}

func balanceErrorMessage(err error) string {
	if errors.Is(err, errInsufficientFunds) {
		return "ยอดเงินในบัญชีไม่พอ"
	}
	if errors.Is(err, errAccountNotFound) {
		return "ไม่พบบัญชี"
	}
	return "failed to update account balance"
}
