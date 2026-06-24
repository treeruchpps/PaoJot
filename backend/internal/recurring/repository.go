package recurring

import (
	"context"
	"errors"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

var ErrNotFound = errors.New("recurring not found")

type Repository struct {
	db *pgxpool.Pool
}

func NewRepository(db *pgxpool.Pool) *Repository {
	return &Repository{db: db}
}

func (r *Repository) List(ctx context.Context, userID string) ([]RecurringTransaction, error) {
	rows, err := r.db.Query(ctx,
		`SELECT id, user_id, account_id, to_account_id, category_id, type, amount,
		        name, note, frequency, next_due_date,
		        is_active, created_at, updated_at
		 FROM recurring_transactions
		 WHERE user_id = $1
		 ORDER BY created_at DESC`,
		userID,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	list := []RecurringTransaction{}
	for rows.Next() {
		var rec RecurringTransaction
		var nextDue time.Time
		if err := rows.Scan(
			&rec.ID, &rec.UserID, &rec.AccountID, &rec.ToAccountID, &rec.CategoryID,
			&rec.Type, &rec.Amount, &rec.Name, &rec.Note,
			&rec.Frequency,
			&nextDue, &rec.IsActive, &rec.CreatedAt, &rec.UpdatedAt,
		); err != nil {
			continue
		}
		rec.NextDueDate = nextDue.Format("2006-01-02")
		list = append(list, rec)
	}
	return list, nil
}

func (r *Repository) Create(ctx context.Context, userID string, req CreateRequest, nextDue time.Time) (RecurringTransaction, error) {
	var rec RecurringTransaction
	var nextDueOut time.Time
	err := r.db.QueryRow(ctx,
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
		&rec.ID, &rec.UserID, &rec.AccountID, &rec.ToAccountID, &rec.CategoryID,
		&rec.Type, &rec.Amount, &rec.Name, &rec.Note,
		&rec.Frequency,
		&nextDueOut, &rec.IsActive, &rec.CreatedAt, &rec.UpdatedAt,
	)
	if err != nil {
		return RecurringTransaction{}, err
	}
	rec.NextDueDate = nextDueOut.Format("2006-01-02")
	return rec, nil
}

func (r *Repository) Update(ctx context.Context, id, userID string, req UpdateRequest, nextDuePtr *time.Time) (RecurringTransaction, error) {
	var rec RecurringTransaction
	var nextDueOut time.Time
	err := r.db.QueryRow(ctx,
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
		&rec.ID, &rec.UserID, &rec.AccountID, &rec.ToAccountID, &rec.CategoryID,
		&rec.Type, &rec.Amount, &rec.Name, &rec.Note,
		&rec.Frequency,
		&nextDueOut, &rec.IsActive, &rec.CreatedAt, &rec.UpdatedAt,
	)
	if err != nil {
		return RecurringTransaction{}, ErrNotFound
	}
	rec.NextDueDate = nextDueOut.Format("2006-01-02")
	return rec, nil
}

func (r *Repository) Delete(ctx context.Context, id, userID string) error {
	result, err := r.db.Exec(ctx,
		`DELETE FROM recurring_transactions WHERE id = $1 AND user_id = $2`, id, userID,
	)
	if err != nil || result.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}
