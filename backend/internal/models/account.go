package models

import "time"

type AccountType string
type AccountKind string

const (
	AccountTypeAsset AccountType = "asset"

	AccountKindCash        AccountKind = "cash"
	AccountKindBankAccount AccountKind = "bank_account"
	AccountKindSavings     AccountKind = "savings"
	AccountKindInvestment  AccountKind = "investment"
	AccountKindEWallet     AccountKind = "e_wallet"
)

type Account struct {
	ID        string      `json:"id"`
	UserID    string      `json:"user_id"`
	Name      string      `json:"name"`
	Type      AccountType `json:"type"`
	Kind      AccountKind `json:"kind"`
	Balance   float64     `json:"balance"`
	Currency  string      `json:"currency"`
	IsActive  bool        `json:"is_active"`
	CreatedAt time.Time   `json:"created_at"`
	UpdatedAt time.Time   `json:"updated_at"`
}

type CreateAccountRequest struct {
	Name     string      `json:"name"     binding:"required,max=100"`
	Type     AccountType `json:"type"     binding:"required,oneof=asset"`
	Kind     AccountKind `json:"kind"     binding:"required"`
	Balance  float64     `json:"balance"  binding:"gte=0"`
	Currency string      `json:"currency"`
}

type UpdateAccountRequest struct {
	Name     *string      `json:"name"`
	Kind     *AccountKind `json:"kind"`
	Currency *string      `json:"currency"`
	IsActive *bool        `json:"is_active"`
}
