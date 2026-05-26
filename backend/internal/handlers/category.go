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
		WITH defaults (name, type, icon, color) AS (
			VALUES
				('อาหาร', 'expense', 'UtensilsCrossed', '#f97316'),
				('เดินทาง', 'expense', 'Car', '#3b82f6'),
				('ของใช้', 'expense', 'Package', '#64748b'),
				('ช้อปปิ้ง', 'expense', 'ShoppingBag', '#ec4899'),
				('บันเทิง', 'expense', 'Gamepad2', '#8b5cf6'),
				('ที่อยู่อาศัย', 'expense', 'Home', '#84cc16'),
				('ชำระบิล', 'expense', 'ReceiptText', '#06b6d4'),
				('สุขภาพ', 'expense', 'HeartPulse', '#10b981'),
				('ครอบครัว', 'expense', 'Users', '#f59e0b'),
				('สัตว์เลี้ยง', 'expense', 'PawPrint', '#5F9A7A'),
				('ของขวัญ', 'expense', 'Gift', '#f59e0b'),
				('การบริจาค', 'expense', 'HandHeart', '#ef4444'),
				('การศึกษา', 'expense', 'GraduationCap', '#6366f1'),
				('ท่องเที่ยว', 'expense', 'Plane', '#2C6488'),
				('งาน', 'expense', 'BriefcaseBusiness', '#475569'),
				('ลงทุน', 'expense', 'TrendingUp', '#5F9A7A'),
				('ชำระหนี้', 'expense', 'CreditCard', '#2C6488'),
				('อื่นๆ', 'expense', 'Tag', '#94a3b8')
		)
		INSERT INTO categories (user_id, name, type, icon, color)
		SELECT NULL, d.name, d.type::transaction_type, d.icon, d.color
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

	query := `SELECT id, user_id, name, type, icon, color, created_at
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
