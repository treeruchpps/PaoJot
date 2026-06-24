package transaction

import (
	"time"

	"paomoney/internal/shared/types"
)

type Transaction struct {
	ID              string                `json:"id"`
	UserID          string                `json:"user_id"`
	AccountID       string                `json:"account_id"`
	ToAccountID     *string               `json:"to_account_id"`
	CategoryID      *string               `json:"category_id"`
	Type            types.TransactionType `json:"type"`
	Amount          float64               `json:"amount"`
	Name            *string               `json:"name"`
	Note            *string               `json:"note"`
	TransactionDate time.Time             `json:"transaction_date"`
	IsRecurring     bool                  `json:"is_recurring"`
	CreatedAt       time.Time             `json:"created_at"`
	UpdatedAt       time.Time             `json:"updated_at"`
}

type CreateRequest struct {
	AccountID       string                `json:"account_id"       binding:"required"`
	ToAccountID     *string               `json:"to_account_id"`
	CategoryID      *string               `json:"category_id"`
	Type            types.TransactionType `json:"type"             binding:"required,oneof=income expense transfer adjustment"`
	Amount          float64               `json:"amount"           binding:"required,gt=0"`
	Name            *string               `json:"name"`
	Note            *string               `json:"note"`
	TransactionDate *string               `json:"transaction_date"`
}

type UpdateRequest struct {
	AccountID       *string                `json:"account_id"`
	ToAccountID     *string                `json:"to_account_id"`
	CategoryID      *string                `json:"category_id"`
	Type            *types.TransactionType `json:"type" binding:"omitempty,oneof=income expense transfer"`
	Amount          *float64               `json:"amount"  binding:"omitempty,gt=0"`
	Name            *string                `json:"name"`
	Note            *string                `json:"note"`
	TransactionDate *string                `json:"transaction_date"`
}

// ListParams คือพารามิเตอร์กรอง/แบ่งหน้าของการดึงรายการธุรกรรม
type ListParams struct {
	AccountID   string
	Type        string
	DateFrom    string
	DateTo      string
	Search      string
	IncludeGoal bool
	SortBy      string
	SortDir     string
	Page        int
	Limit       int
}

// ListResult คือผลลัพธ์การดึงรายการพร้อมสถิติและข้อมูลแบ่งหน้า
type ListResult struct {
	Items        []Transaction
	Total        int
	TotalIncome  float64
	TotalExpense float64
	Page         int
	Limit        int
	SortBy       string
	SortDir      string
}
