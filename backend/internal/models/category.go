package models

import "time"

type Category struct {
	ID        string          `json:"id"`
	UserID    *string         `json:"user_id"`
	Name      string          `json:"name"`
	Type      TransactionType `json:"type"`
	CreatedAt time.Time       `json:"created_at"`
}

type CreateCategoryRequest struct {
	Name string          `json:"name"  binding:"required,max=100"`
	Type TransactionType `json:"type"  binding:"required,oneof=income expense transfer"`
}

type UpdateCategoryRequest struct {
	Name *string `json:"name"`
}
