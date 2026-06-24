package recurring

import "time"

type RecurringTransaction struct {
	ID          string    `json:"id"`
	UserID      string    `json:"user_id"`
	AccountID   string    `json:"account_id"`
	ToAccountID *string   `json:"to_account_id"`
	CategoryID  *string   `json:"category_id"`
	Type        string    `json:"type"`
	Amount      float64   `json:"amount"`
	Name        *string   `json:"name"`
	Note        *string   `json:"note"`
	Frequency   string    `json:"frequency"`
	NextDueDate string    `json:"next_due_date"`
	IsActive    bool      `json:"is_active"`
	CreatedAt   time.Time `json:"created_at"`
	UpdatedAt   time.Time `json:"updated_at"`
}

type CreateRequest struct {
	AccountID   string  `json:"account_id"   binding:"required"`
	ToAccountID *string `json:"to_account_id"`
	CategoryID  *string `json:"category_id"`
	Type        string  `json:"type"         binding:"required"`
	Amount      float64 `json:"amount"       binding:"required,gt=0"`
	Name        *string `json:"name"`
	Note        *string `json:"note"`
	Frequency   string  `json:"frequency"    binding:"required"`
	NextDueDate string  `json:"next_due_date" binding:"required"`
}

type UpdateRequest struct {
	CategoryID  *string  `json:"category_id"`
	Amount      *float64 `json:"amount" binding:"omitempty,gt=0"`
	Name        *string  `json:"name"`
	Note        *string  `json:"note"`
	Frequency   *string  `json:"frequency"`
	NextDueDate *string  `json:"next_due_date"`
	IsActive    *bool    `json:"is_active"`
}
