package models

import "time"

type TransactionType string

const (
	TransactionTypeIncome         TransactionType = "income"
	TransactionTypeExpense        TransactionType = "expense"
	TransactionTypeTransfer       TransactionType = "transfer"
	TransactionTypeAdjustment     TransactionType = "adjustment"
	TransactionTypeGoalDeposit    TransactionType = "goal_deposit"
	TransactionTypeGoalWithdrawal TransactionType = "goal_withdrawal"
)

type Transaction struct {
	ID              string          `json:"id"`
	UserID          string          `json:"user_id"`
	AccountID       string          `json:"account_id"`
	ToAccountID     *string         `json:"to_account_id"`
	CategoryID      *string         `json:"category_id"`
	Type            TransactionType `json:"type"`
	Amount          float64         `json:"amount"`
	Name            *string         `json:"name"`
	Note            *string         `json:"note"`
	TransactionDate time.Time       `json:"transaction_date"`
	IsRecurring     bool            `json:"is_recurring"`
	CreatedAt       time.Time       `json:"created_at"`
	UpdatedAt       time.Time       `json:"updated_at"`
}

type CreateTransactionRequest struct {
	AccountID       string          `json:"account_id"       binding:"required"`
	ToAccountID     *string         `json:"to_account_id"`
	CategoryID      *string         `json:"category_id"`
	Type            TransactionType `json:"type"             binding:"required,oneof=income expense transfer adjustment"`
	Amount          float64         `json:"amount"           binding:"required,gt=0"`
	Name            *string         `json:"name"`
	Note            *string         `json:"note"`
	TransactionDate *string         `json:"transaction_date"`
}

type UpdateTransactionRequest struct {
	AccountID       *string          `json:"account_id"`
	ToAccountID     *string          `json:"to_account_id"`
	CategoryID      *string          `json:"category_id"`
	Type            *TransactionType `json:"type" binding:"omitempty,oneof=income expense transfer"`
	Amount          *float64         `json:"amount"  binding:"omitempty,gt=0"`
	Name            *string          `json:"name"`
	Note            *string          `json:"note"`
	TransactionDate *string          `json:"transaction_date"`
}

type TransactionFilter struct {
	AccountID  string
	Type       string
	DateFrom   string
	DateTo     string
	CategoryID string
	Page       int
	Limit      int
}
