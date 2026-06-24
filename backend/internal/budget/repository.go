package budget

import (
	"context"
	"errors"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

var ErrNotFound = errors.New("budget not found")

type Repository struct {
	db *pgxpool.Pool
}

func NewRepository(db *pgxpool.Pool) *Repository {
	return &Repository{db: db}
}

// EnsureSchema เติม/ปรับคอลัมน์ของตาราง budgets ให้เข้ากับสคีมาปัจจุบัน
func (r *Repository) EnsureSchema(ctx context.Context) error {
	_, err := r.db.Exec(ctx, `
		ALTER TABLE budgets ADD COLUMN IF NOT EXISTS start_date DATE;
		ALTER TABLE budgets ADD COLUMN IF NOT EXISTS end_date DATE;
		ALTER TABLE budgets ADD COLUMN IF NOT EXISTS budget_type VARCHAR(20) NOT NULL DEFAULT 'month';
		ALTER TABLE budgets ADD COLUMN IF NOT EXISTS is_recurring BOOLEAN NOT NULL DEFAULT FALSE;
		ALTER TABLE budgets ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT TRUE;

		DO $$
		BEGIN
			IF EXISTS (
				SELECT 1 FROM information_schema.columns
				WHERE table_name = 'budgets' AND column_name = 'name'
			) THEN
				ALTER TABLE budgets ALTER COLUMN name DROP NOT NULL;
			END IF;

			IF EXISTS (
				SELECT 1 FROM information_schema.columns
				WHERE table_name = 'budgets' AND column_name = 'period'
			) THEN
				UPDATE budgets
				SET start_date = CASE period::text
						WHEN 'weekly' THEN date_trunc('week', CURRENT_DATE)::date
						WHEN 'yearly' THEN date_trunc('year', CURRENT_DATE)::date
						ELSE date_trunc('month', CURRENT_DATE)::date
					END
				WHERE start_date IS NULL;

				UPDATE budgets
				SET end_date = CASE period::text
						WHEN 'weekly' THEN (date_trunc('week', CURRENT_DATE) + interval '6 days')::date
						WHEN 'yearly' THEN (date_trunc('year', CURRENT_DATE) + interval '1 year - 1 day')::date
						ELSE (date_trunc('month', CURRENT_DATE) + interval '1 month - 1 day')::date
					END
				WHERE end_date IS NULL;
			END IF;
		END $$;

		UPDATE budgets SET start_date = CURRENT_DATE WHERE start_date IS NULL;
		UPDATE budgets SET end_date = CURRENT_DATE WHERE end_date IS NULL;
		UPDATE budgets SET budget_type = 'custom'
		WHERE budget_type IS NULL OR budget_type NOT IN ('week', 'month', 'year', 'custom');
	`)
	return err
}

// WeekStartDay คืนวันเริ่มสัปดาห์ของผู้ใช้ (ค่าเริ่มต้น 1 = จันทร์)
func (r *Repository) WeekStartDay(ctx context.Context, userID string) int {
	var day int
	if err := r.db.QueryRow(ctx, `SELECT week_start_day FROM user_profiles WHERE user_id = $1`, userID).Scan(&day); err != nil {
		return 1
	}
	if day < 0 || day > 6 {
		return 1
	}
	return day
}

// CategoryExists เช็คว่ามีงบประมาณประเภทเดียวกันของหมวดนี้อยู่แล้วหรือยัง
func (r *Repository) CategoryExists(ctx context.Context, userID, categoryID, budgetType string, excludeID *string) bool {
	query := `
		SELECT EXISTS (
			SELECT 1 FROM budgets
			WHERE user_id = $1
			  AND category_id = $2
			  AND budget_type = $3
			  AND is_active = TRUE`
	args := []interface{}{userID, categoryID, budgetType}
	if excludeID != nil {
		query += " AND id <> $4"
		args = append(args, *excludeID)
	}
	query += ")"

	var exists bool
	if err := r.db.QueryRow(ctx, query, args...).Scan(&exists); err != nil {
		return false
	}
	return exists
}

// RefreshWindows เลื่อนช่วงงบที่หมดอายุ (recurring) หรือปิดงบที่ไม่ recurring
func (r *Repository) RefreshWindows(ctx context.Context, userID string) {
	today := dateOnly(time.Now())
	weekStartDay := r.WeekStartDay(ctx, userID)
	rows, err := r.db.Query(ctx, `
		SELECT id, budget_type, start_date, end_date, is_recurring
		FROM budgets
		WHERE user_id = $1 AND is_active = TRUE AND end_date < CURRENT_DATE
	`, userID)
	if err != nil {
		return
	}
	defer rows.Close()

	for rows.Next() {
		var id string
		var budgetType string
		var start, end time.Time
		var recurring bool
		if err := rows.Scan(&id, &budgetType, &start, &end, &recurring); err != nil {
			continue
		}
		if !recurring {
			r.db.Exec(ctx, `UPDATE budgets SET is_active = FALSE WHERE id = $1 AND user_id = $2`, id, userID) //nolint
			continue
		}
		nextStart, nextEnd := nextWindow(start, end, today, budgetType, weekStartDay)
		r.db.Exec(ctx, `UPDATE budgets SET start_date = $1, end_date = $2 WHERE id = $3 AND user_id = $4`, dateString(nextStart), dateString(nextEnd), id, userID) //nolint
	}
}

func (r *Repository) List(ctx context.Context, userID, typeFilter string) ([]Budget, error) {
	args := []interface{}{userID}
	typeCondition := ""
	if typeFilter != "" && typeFilter != "all" {
		typeCondition = " AND b.budget_type = $2"
		args = append(args, typeFilter)
	}

	rows, err := r.db.Query(ctx,
		`SELECT b.id, b.user_id, b.category_id, b.amount, b.budget_type, b.start_date, b.end_date,
		        b.is_recurring, b.is_active, b.created_at, b.updated_at,
		        COALESCE((
		          SELECT SUM(t.amount)
		          FROM transactions t
		          WHERE t.user_id = b.user_id
		            AND t.type = 'expense'
		            AND (b.category_id IS NULL OR t.category_id = b.category_id)
		            AND t.transaction_date >= b.start_date
		            AND t.transaction_date <= b.end_date
		        ), 0) AS spent
		 FROM budgets b
		 WHERE b.user_id = $1 AND b.is_active = TRUE AND b.end_date >= CURRENT_DATE
		 `+typeCondition+`
		 ORDER BY
		   CASE b.budget_type WHEN 'week' THEN 1 WHEN 'month' THEN 2 WHEN 'year' THEN 3 ELSE 4 END,
		   b.end_date ASC, b.created_at DESC`,
		args...,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	budgets := []Budget{}
	for rows.Next() {
		var b Budget
		var start, end time.Time
		if err := rows.Scan(&b.ID, &b.UserID, &b.CategoryID, &b.Amount, &b.BudgetType, &start, &end,
			&b.IsRecurring, &b.IsActive, &b.CreatedAt, &b.UpdatedAt, &b.Spent); err != nil {
			continue
		}
		b.StartDate = dateString(start)
		b.EndDate = dateString(end)
		budgets = append(budgets, b)
	}
	return budgets, rows.Err()
}

func (r *Repository) GetByID(ctx context.Context, id, userID string) (Budget, error) {
	var b Budget
	var start, end time.Time
	err := r.db.QueryRow(ctx,
		`SELECT id, user_id, category_id, amount, budget_type, start_date, end_date, is_recurring, is_active, created_at, updated_at
		 FROM budgets WHERE id = $1 AND user_id = $2`,
		id, userID,
	).Scan(&b.ID, &b.UserID, &b.CategoryID, &b.Amount, &b.BudgetType, &start, &end, &b.IsRecurring, &b.IsActive, &b.CreatedAt, &b.UpdatedAt)
	if err != nil {
		return Budget{}, ErrNotFound
	}
	b.StartDate = dateString(start)
	b.EndDate = dateString(end)
	return b, nil
}

func (r *Repository) Create(ctx context.Context, userID string, req CreateRequest) (Budget, error) {
	var b Budget
	var start, end time.Time
	err := r.db.QueryRow(ctx,
		`INSERT INTO budgets (user_id, category_id, amount, budget_type, start_date, end_date, is_recurring)
		 VALUES ($1, $2, $3, $4, $5, $6, $7)
		 RETURNING id, user_id, category_id, amount, budget_type, start_date, end_date, is_recurring, is_active, created_at, updated_at`,
		userID, req.CategoryID, req.Amount, req.BudgetType, req.StartDate, req.EndDate, req.IsRecurring,
	).Scan(&b.ID, &b.UserID, &b.CategoryID, &b.Amount, &b.BudgetType, &start, &end, &b.IsRecurring, &b.IsActive, &b.CreatedAt, &b.UpdatedAt)
	if err != nil {
		return Budget{}, err
	}
	b.StartDate = dateString(start)
	b.EndDate = dateString(end)
	return b, nil
}

// CurrentForUpdate ดึงค่าปัจจุบันของงบเพื่อใช้คำนวณค่าใหม่ตอนแก้ไข
func (r *Repository) CurrentForUpdate(ctx context.Context, id, userID string) (categoryID *string, budgetType string, start, end time.Time, err error) {
	err = r.db.QueryRow(ctx,
		`SELECT category_id, budget_type, start_date, end_date FROM budgets WHERE id = $1 AND user_id = $2`,
		id, userID,
	).Scan(&categoryID, &budgetType, &start, &end)
	if err != nil {
		return nil, "", time.Time{}, time.Time{}, ErrNotFound
	}
	return categoryID, budgetType, start, end, nil
}

func (r *Repository) Update(ctx context.Context, id, userID string, categoryID *string, amount *float64, budgetType string, startDate, endDate *string, isRecurring, isActive *bool) (Budget, error) {
	var b Budget
	var start, end time.Time
	err := r.db.QueryRow(ctx,
		`UPDATE budgets
		 SET category_id  = $1,
		     amount       = COALESCE($2, amount),
		     budget_type  = COALESCE($3, budget_type),
		     start_date   = COALESCE($4, start_date),
		     end_date     = COALESCE($5, end_date),
		     is_recurring = COALESCE($6, is_recurring),
		     is_active    = COALESCE($7, is_active)
		 WHERE id = $8 AND user_id = $9
		   AND COALESCE($5, end_date) >= COALESCE($4, start_date)
		 RETURNING id, user_id, category_id, amount, budget_type, start_date, end_date, is_recurring, is_active, created_at, updated_at`,
		categoryID, amount, budgetType, startDate, endDate, isRecurring, isActive, id, userID,
	).Scan(&b.ID, &b.UserID, &b.CategoryID, &b.Amount, &b.BudgetType, &start, &end, &b.IsRecurring, &b.IsActive, &b.CreatedAt, &b.UpdatedAt)
	if err != nil {
		return Budget{}, ErrNotFound
	}
	b.StartDate = dateString(start)
	b.EndDate = dateString(end)
	return b, nil
}

func (r *Repository) Delete(ctx context.Context, id, userID string) error {
	result, err := r.db.Exec(ctx,
		`DELETE FROM budgets WHERE id = $1 AND user_id = $2`,
		id, userID,
	)
	if err != nil || result.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}
