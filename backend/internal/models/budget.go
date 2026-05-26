package models

import "time"

type Budget struct {
	ID          string    `json:"id"`
	UserID      string    `json:"user_id"`
	CategoryID  *string   `json:"category_id"`
	Amount      float64   `json:"amount"`
	BudgetType  string    `json:"budget_type"`
	StartDate   string    `json:"start_date"`
	EndDate     string    `json:"end_date"`
	IsRecurring bool      `json:"is_recurring"`
	IsActive    bool      `json:"is_active"`
	Spent       float64   `json:"spent"`
	CreatedAt   time.Time `json:"created_at"`
	UpdatedAt   time.Time `json:"updated_at"`
}

type CreateBudgetRequest struct {
	CategoryID  *string `json:"category_id"`
	Amount      float64 `json:"amount"       binding:"required,gt=0"`
	BudgetType  string  `json:"budget_type"  binding:"required,oneof=week month year custom"`
	StartDate   string  `json:"start_date"   binding:"required"`
	EndDate     string  `json:"end_date"     binding:"required"`
	IsRecurring bool    `json:"is_recurring"`
}

type UpdateBudgetRequest struct {
	CategoryID  *string  `json:"category_id"`
	Amount      *float64 `json:"amount"       binding:"omitempty,gt=0"`
	BudgetType  *string  `json:"budget_type"  binding:"omitempty,oneof=week month year custom"`
	StartDate   *string  `json:"start_date"`
	EndDate     *string  `json:"end_date"`
	IsRecurring *bool    `json:"is_recurring"`
	IsActive    *bool    `json:"is_active"`
}
