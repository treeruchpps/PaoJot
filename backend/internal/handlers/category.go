package handlers

import (
	"context"
	"net/http"
	"paomoney/internal/models"

	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5/pgxpool"
)

type CategoryHandler struct {
	db *pgxpool.Pool
}

func NewCategoryHandler(db *pgxpool.Pool) *CategoryHandler {
	ensureDefaultCategories(context.Background(), db)
	return &CategoryHandler{db: db}
}

func ensureDefaultCategories(ctx context.Context, db *pgxpool.Pool) {
	_, _ = db.Exec(ctx, `
		INSERT INTO categories (user_id, name, type, icon, color)
		SELECT NULL, 'ชำระหนี้', 'expense', 'CreditCard', '#2C6488'
		WHERE NOT EXISTS (
			SELECT 1 FROM categories
			WHERE user_id IS NULL AND type = 'expense' AND name = 'ชำระหนี้'
		)
	`)
}

// GET /api/v1/categories
func (h *CategoryHandler) List(c *gin.Context) {
	userID := c.GetString("user_id")
	typeFilter := c.Query("type")

	query := `SELECT id, user_id, name, type, icon, color, created_at
			  FROM categories
			  WHERE (user_id = $1 OR user_id IS NULL)`
	args := []interface{}{userID}

	if typeFilter != "" {
		query += " AND type = $2"
		args = append(args, typeFilter)
	}
	query += " ORDER BY user_id NULLS FIRST, created_at ASC"

	rows, err := h.db.Query(context.Background(), query, args...)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to fetch categories"})
		return
	}
	defer rows.Close()

	categories := []models.Category{}
	for rows.Next() {
		var cat models.Category
		if err := rows.Scan(&cat.ID, &cat.UserID, &cat.Name, &cat.Type,
			&cat.Icon, &cat.Color, &cat.CreatedAt); err != nil {
			continue
		}
		categories = append(categories, cat)
	}

	c.JSON(http.StatusOK, categories)
}

// POST /api/v1/categories
func (h *CategoryHandler) Create(c *gin.Context) {
	userID := c.GetString("user_id")

	var req models.CreateCategoryRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	var cat models.Category
	err := h.db.QueryRow(context.Background(),
		`INSERT INTO categories (user_id, name, type, icon, color)
		 VALUES ($1, $2, $3, $4, $5)
		 RETURNING id, user_id, name, type, icon, color, created_at`,
		userID, req.Name, req.Type, req.Icon, req.Color,
	).Scan(&cat.ID, &cat.UserID, &cat.Name, &cat.Type,
		&cat.Icon, &cat.Color, &cat.CreatedAt)

	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to create category"})
		return
	}

	c.JSON(http.StatusCreated, cat)
}

// PUT /api/v1/categories/:id
func (h *CategoryHandler) Update(c *gin.Context) {
	userID := c.GetString("user_id")
	id := c.Param("id")

	var req models.UpdateCategoryRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	var cat models.Category
	err := h.db.QueryRow(context.Background(),
		`UPDATE categories
		 SET name  = COALESCE($1, name),
		     icon  = COALESCE($2, icon),
		     color = COALESCE($3, color)
		 WHERE id = $4 AND user_id = $5
		 RETURNING id, user_id, name, type, icon, color, created_at`,
		req.Name, req.Icon, req.Color, id, userID,
	).Scan(&cat.ID, &cat.UserID, &cat.Name, &cat.Type,
		&cat.Icon, &cat.Color, &cat.CreatedAt)

	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "category not found or not editable"})
		return
	}

	c.JSON(http.StatusOK, cat)
}

// DELETE /api/v1/categories/:id
func (h *CategoryHandler) Delete(c *gin.Context) {
	userID := c.GetString("user_id")
	id := c.Param("id")

	result, err := h.db.Exec(context.Background(),
		`DELETE FROM categories WHERE id = $1 AND user_id = $2`,
		id, userID,
	)
	if err != nil || result.RowsAffected() == 0 {
		c.JSON(http.StatusNotFound, gin.H{"error": "category not found or not deletable"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"message": "category deleted"})
}
