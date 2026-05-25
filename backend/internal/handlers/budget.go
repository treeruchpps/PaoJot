package handlers

import (
	"context"
	"net/http"
	"paomoney/internal/models"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5/pgxpool"
)

type BudgetHandler struct {
	db *pgxpool.Pool
}

func NewBudgetHandler(db *pgxpool.Pool) *BudgetHandler {
	h := &BudgetHandler{db: db}
	_ = h.ensureBudgetSchema(context.Background())
	return h
}

func (h *BudgetHandler) ensureBudgetSchema(ctx context.Context) error {
	_, err := h.db.Exec(ctx, `
		ALTER TABLE budgets ADD COLUMN IF NOT EXISTS start_date DATE;
		ALTER TABLE budgets ADD COLUMN IF NOT EXISTS end_date DATE;
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
	`)
	return err
}

func parseBudgetDate(value string) (time.Time, error) {
	return time.Parse("2006-01-02", value)
}

func budgetDateString(t time.Time) string {
	return t.Format("2006-01-02")
}

func nextBudgetWindow(start, end time.Time, today time.Time) (time.Time, time.Time) {
	durationDays := int(end.Sub(start).Hours()/24) + 1
	if durationDays < 1 {
		durationDays = 1
	}
	for end.Before(today) {
		start = end.AddDate(0, 0, 1)
		end = start.AddDate(0, 0, durationDays-1)
	}
	return start, end
}

func (h *BudgetHandler) refreshBudgetWindows(ctx context.Context, userID string) {
	today := time.Now().Truncate(24 * time.Hour)
	rows, err := h.db.Query(ctx, `
		SELECT id, start_date, end_date, is_recurring
		FROM budgets
		WHERE user_id = $1 AND is_active = TRUE AND end_date < CURRENT_DATE
	`, userID)
	if err != nil {
		return
	}
	defer rows.Close()

	for rows.Next() {
		var id string
		var start, end time.Time
		var recurring bool
		if err := rows.Scan(&id, &start, &end, &recurring); err != nil {
			continue
		}
		if !recurring {
			h.db.Exec(ctx, `UPDATE budgets SET is_active = FALSE WHERE id = $1 AND user_id = $2`, id, userID) //nolint
			continue
		}
		nextStart, nextEnd := nextBudgetWindow(start, end, today)
		h.db.Exec(ctx, `UPDATE budgets SET start_date = $1, end_date = $2 WHERE id = $3 AND user_id = $4`, budgetDateString(nextStart), budgetDateString(nextEnd), id, userID) //nolint
	}
}

// GET /api/v1/budgets
func (h *BudgetHandler) List(c *gin.Context) {
	userID := c.GetString("user_id")
	ctx := context.Background()
	h.refreshBudgetWindows(ctx, userID)

	rows, err := h.db.Query(ctx,
		`SELECT b.id, b.user_id, b.category_id, b.amount, b.start_date, b.end_date,
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
		 ORDER BY b.end_date ASC, b.created_at DESC`,
		userID,
	)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to fetch budgets"})
		return
	}
	defer rows.Close()

	budgets := []models.Budget{}
	for rows.Next() {
		var b models.Budget
		var start, end time.Time
		if err := rows.Scan(&b.ID, &b.UserID, &b.CategoryID, &b.Amount, &start, &end,
			&b.IsRecurring, &b.IsActive, &b.CreatedAt, &b.UpdatedAt, &b.Spent); err != nil {
			continue
		}
		b.StartDate = budgetDateString(start)
		b.EndDate = budgetDateString(end)
		budgets = append(budgets, b)
	}

	c.JSON(http.StatusOK, budgets)
}

// POST /api/v1/budgets
func (h *BudgetHandler) Create(c *gin.Context) {
	userID := c.GetString("user_id")

	var req models.CreateBudgetRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	start, err := parseBudgetDate(req.StartDate)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid start_date, use YYYY-MM-DD"})
		return
	}
	end, err := parseBudgetDate(req.EndDate)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid end_date, use YYYY-MM-DD"})
		return
	}
	if end.Before(start) {
		c.JSON(http.StatusBadRequest, gin.H{"error": "end_date must be after start_date"})
		return
	}

	var b models.Budget
	err = h.db.QueryRow(context.Background(),
		`INSERT INTO budgets (user_id, category_id, amount, start_date, end_date, is_recurring)
		 VALUES ($1, $2, $3, $4, $5, $6)
		 RETURNING id, user_id, category_id, amount, start_date, end_date, is_recurring, is_active, created_at, updated_at`,
		userID, req.CategoryID, req.Amount, req.StartDate, req.EndDate, req.IsRecurring,
	).Scan(&b.ID, &b.UserID, &b.CategoryID, &b.Amount, &start, &end, &b.IsRecurring, &b.IsActive, &b.CreatedAt, &b.UpdatedAt)

	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to create budget"})
		return
	}
	b.StartDate = budgetDateString(start)
	b.EndDate = budgetDateString(end)

	c.JSON(http.StatusCreated, b)
}

// GET /api/v1/budgets/:id
func (h *BudgetHandler) Get(c *gin.Context) {
	userID := c.GetString("user_id")
	id := c.Param("id")

	var b models.Budget
	var start, end time.Time
	err := h.db.QueryRow(context.Background(),
		`SELECT id, user_id, category_id, amount, start_date, end_date, is_recurring, is_active, created_at, updated_at
		 FROM budgets WHERE id = $1 AND user_id = $2`,
		id, userID,
	).Scan(&b.ID, &b.UserID, &b.CategoryID, &b.Amount, &start, &end, &b.IsRecurring, &b.IsActive, &b.CreatedAt, &b.UpdatedAt)

	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "budget not found"})
		return
	}
	b.StartDate = budgetDateString(start)
	b.EndDate = budgetDateString(end)

	c.JSON(http.StatusOK, b)
}

// PUT /api/v1/budgets/:id
func (h *BudgetHandler) Update(c *gin.Context) {
	userID := c.GetString("user_id")
	id := c.Param("id")

	var req models.UpdateBudgetRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if req.StartDate != nil {
		if _, err := parseBudgetDate(*req.StartDate); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid start_date, use YYYY-MM-DD"})
			return
		}
	}
	if req.EndDate != nil {
		if _, err := parseBudgetDate(*req.EndDate); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid end_date, use YYYY-MM-DD"})
			return
		}
	}

	var b models.Budget
	var start, end time.Time
	err := h.db.QueryRow(context.Background(),
		`UPDATE budgets
		 SET category_id  = $1,
		     amount       = COALESCE($2, amount),
		     start_date   = COALESCE($3, start_date),
		     end_date     = COALESCE($4, end_date),
		     is_recurring = COALESCE($5, is_recurring),
		     is_active    = COALESCE($6, is_active)
		 WHERE id = $7 AND user_id = $8
		   AND COALESCE($4, end_date) >= COALESCE($3, start_date)
		 RETURNING id, user_id, category_id, amount, start_date, end_date, is_recurring, is_active, created_at, updated_at`,
		req.CategoryID, req.Amount, req.StartDate, req.EndDate, req.IsRecurring, req.IsActive, id, userID,
	).Scan(&b.ID, &b.UserID, &b.CategoryID, &b.Amount, &start, &end, &b.IsRecurring, &b.IsActive, &b.CreatedAt, &b.UpdatedAt)

	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "budget not found"})
		return
	}
	b.StartDate = budgetDateString(start)
	b.EndDate = budgetDateString(end)

	c.JSON(http.StatusOK, b)
}

// DELETE /api/v1/budgets/:id
func (h *BudgetHandler) Delete(c *gin.Context) {
	userID := c.GetString("user_id")
	id := c.Param("id")

	result, err := h.db.Exec(context.Background(),
		`DELETE FROM budgets WHERE id = $1 AND user_id = $2`,
		id, userID,
	)
	if err != nil || result.RowsAffected() == 0 {
		c.JSON(http.StatusNotFound, gin.H{"error": "budget not found"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"message": "budget deleted"})
}
