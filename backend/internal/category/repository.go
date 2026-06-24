package category

import (
	"context"
	"errors"

	"github.com/jackc/pgx/v5/pgxpool"
)

// ErrNotFound = ไม่พบหมวดหมู่ หรือเป็นหมวดเริ่มต้นที่แก้/ลบไม่ได้
var ErrNotFound = errors.New("category not found")

type Repository struct {
	db *pgxpool.Pool
}

func NewRepository(db *pgxpool.Pool) *Repository {
	return &Repository{db: db}
}

// EnsureDefaults เติมหมวดรายจ่ายเริ่มต้นของระบบ (user_id = NULL) ถ้ายังไม่มี
func (r *Repository) EnsureDefaults(ctx context.Context) error {
	_, err := r.db.Exec(ctx, `
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
	return err
}

// List คืนหมวดของผู้ใช้ + หมวดเริ่มต้น เรียงตามลำดับที่กำหนด (กรองตาม type ได้)
func (r *Repository) List(ctx context.Context, userID, typeFilter string) ([]Category, error) {
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

	rows, err := r.db.Query(ctx, query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	categories := []Category{}
	for rows.Next() {
		var cat Category
		if err := rows.Scan(&cat.ID, &cat.UserID, &cat.Name, &cat.Type, &cat.CreatedAt); err != nil {
			continue
		}
		categories = append(categories, cat)
	}
	return categories, rows.Err()
}

// Create บันทึกหมวดใหม่ของผู้ใช้
func (r *Repository) Create(ctx context.Context, userID string, req CreateRequest) (Category, error) {
	var cat Category
	err := r.db.QueryRow(ctx,
		`INSERT INTO categories (user_id, name, type)
		 VALUES ($1, $2, $3)
		 RETURNING id, user_id, name, type, created_at`,
		userID, req.Name, req.Type,
	).Scan(&cat.ID, &cat.UserID, &cat.Name, &cat.Type, &cat.CreatedAt)
	return cat, err
}

// Update แก้ชื่อหมวดของผู้ใช้ (หมวดเริ่มต้นแก้ไม่ได้ → ErrNotFound)
func (r *Repository) Update(ctx context.Context, id, userID string, req UpdateRequest) (Category, error) {
	var cat Category
	err := r.db.QueryRow(ctx,
		`UPDATE categories
		 SET name = COALESCE($1, name)
		 WHERE id = $2 AND user_id = $3
		 RETURNING id, user_id, name, type, created_at`,
		req.Name, id, userID,
	).Scan(&cat.ID, &cat.UserID, &cat.Name, &cat.Type, &cat.CreatedAt)
	if err != nil {
		return Category{}, ErrNotFound
	}
	return cat, nil
}

// Delete ลบหมวดของผู้ใช้ (หมวดเริ่มต้นลบไม่ได้ → ErrNotFound)
func (r *Repository) Delete(ctx context.Context, id, userID string) error {
	result, err := r.db.Exec(ctx,
		`DELETE FROM categories WHERE id = $1 AND user_id = $2`,
		id, userID,
	)
	if err != nil || result.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}
