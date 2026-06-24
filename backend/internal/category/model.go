package category

import (
	"time"

	"paomoney/internal/shared/types"
)

// Category คือหมวดหมู่ของธุรกรรม (user_id เป็น nil = หมวดเริ่มต้นของระบบ)
type Category struct {
	ID        string                `json:"id"`
	UserID    *string               `json:"user_id"`
	Name      string                `json:"name"`
	Type      types.TransactionType `json:"type"`
	CreatedAt time.Time             `json:"created_at"`
}

type CreateRequest struct {
	Name string                `json:"name"  binding:"required,max=100"`
	Type types.TransactionType `json:"type"  binding:"required,oneof=income expense transfer"`
}

type UpdateRequest struct {
	Name *string `json:"name"`
}
