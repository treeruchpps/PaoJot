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
		WITH defaults (name, type) AS (
			VALUES
				('อาหาร', 'expense'),
				('เดินทาง', 'expense'),
				('ของใช้', 'expense'),
				('ช้อปปิ้ง', 'expense'),
				('บันเทิง', 'expense'),
				('ที่อยู่อาศัย', 'expense'),
				('ชำระบิล', 'expense'),
				('สุขภาพ', 'expense'),
				('ครอบครัว', 'expense'),
				('สัตว์เลี้ยง', 'expense'),
				('ของขวัญ', 'expense'),
				('การบริจาค', 'expense'),
				('การศึกษา', 'expense'),
				('ท่องเที่ยว', 'expense'),
				('งาน', 'expense'),
				('ลงทุน', 'expense'),
				('ชำระหนี้', 'expense'),
				('อื่นๆ', 'expense')
		)
		INSERT INTO categories (user_id, name, type)
		SELECT NULL, d.name, d.type::transaction_type
		FROM defaults d
		WHERE NOT EXISTS (
			SELECT 1 FROM categories
			WHERE user_id IS NULL AND type = d.type::transaction_type AND name = d.name
		)
	`)
}

// GET /api/v1/categories
func (h *CategoryHandler) List(c *gin.Context) {
	userID := c.GetString("user_id")
	typeFilter := c.Query("type")

	query := `SELECT id, user_id, name, type, created_at
			  FROM categories
			  WHERE (user_id = $1 OR user_id IS NULL)`
	args := []interface{}{userID}

	if typeFilter != "" {
		query += " AND type = $2"
		args = append(args, typeFilter)
	}
	query += `
		ORDER BY
			type,
			CASE
				WHEN type = 'expense' AND user_id IS NULL AND name IN (
					'อาหาร', 'เดินทาง', 'ของใช้', 'ช้อปปิ้ง', 'บันเทิง', 'ที่อยู่อาศัย',
					'ชำระบิล', 'สุขภาพ', 'ครอบครัว', 'สัตว์เลี้ยง', 'ของขวัญ',
					'การบริจาค', 'การศึกษา', 'ท่องเที่ยว', 'งาน', 'ลงทุน', 'ชำระหนี้'
				) THEN 0
				WHEN user_id IS NOT NULL THEN 1
				WHEN user_id IS NULL AND name = 'อื่นๆ' THEN 3
				ELSE 2
			END,
			CASE
				WHEN type = 'expense' AND name = 'อาหาร' THEN 1
				WHEN type = 'expense' AND name = 'เดินทาง' THEN 2
				WHEN type = 'expense' AND name = 'ของใช้' THEN 3
				WHEN type = 'expense' AND name = 'ช้อปปิ้ง' THEN 4
				WHEN type = 'expense' AND name = 'บันเทิง' THEN 5
				WHEN type = 'expense' AND name = 'ที่อยู่อาศัย' THEN 6
				WHEN type = 'expense' AND name = 'ชำระบิล' THEN 7
				WHEN type = 'expense' AND name = 'สุขภาพ' THEN 8
				WHEN type = 'expense' AND name = 'ครอบครัว' THEN 9
				WHEN type = 'expense' AND name = 'สัตว์เลี้ยง' THEN 10
				WHEN type = 'expense' AND name = 'ของขวัญ' THEN 11
				WHEN type = 'expense' AND name = 'การบริจาค' THEN 12
				WHEN type = 'expense' AND name = 'การศึกษา' THEN 13
				WHEN type = 'expense' AND name = 'ท่องเที่ยว' THEN 14
				WHEN type = 'expense' AND name = 'งาน' THEN 15
				WHEN type = 'expense' AND name = 'ลงทุน' THEN 16
				WHEN type = 'expense' AND name = 'ชำระหนี้' THEN 17
				WHEN type = 'expense' AND name = 'อื่นๆ' THEN 99
				ELSE 50
			END,
			created_at ASC`

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
			&cat.CreatedAt); err != nil {
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
		`INSERT INTO categories (user_id, name, type)
		 VALUES ($1, $2, $3)
		 RETURNING id, user_id, name, type, created_at`,
		userID, req.Name, req.Type,
	).Scan(&cat.ID, &cat.UserID, &cat.Name, &cat.Type,
		&cat.CreatedAt)

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
		 SET name = COALESCE($1, name)
		 WHERE id = $2 AND user_id = $3
		 RETURNING id, user_id, name, type, created_at`,
		req.Name, id, userID,
	).Scan(&cat.ID, &cat.UserID, &cat.Name, &cat.Type,
		&cat.CreatedAt)

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
