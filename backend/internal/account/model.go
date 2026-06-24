package account

import "time"

// Type คือประเภทบัญชี (ปัจจุบันรองรับเฉพาะ asset)
type Type string

// Kind คือชนิดย่อยของบัญชี
type Kind string

const (
	TypeAsset Type = "asset"

	KindCash        Kind = "cash"
	KindBankAccount Kind = "bank_account"
	KindSavings     Kind = "savings"
	KindInvestment  Kind = "investment"
	KindEWallet     Kind = "e_wallet"
	KindSavingsGoal Kind = "savings_goal"
)

// Account คือ entity บัญชีเงินของผู้ใช้
type Account struct {
	ID        string    `json:"id"`
	UserID    string    `json:"user_id"`
	Name      string    `json:"name"`
	Type      Type      `json:"type"`
	Kind      Kind      `json:"kind"`
	Balance   float64   `json:"balance"`
	Currency  string    `json:"currency"`
	IsActive  bool      `json:"is_active"`
	CreatedAt time.Time `json:"created_at"`
	UpdatedAt time.Time `json:"updated_at"`
}

// CreateRequest คือ payload สำหรับสร้างบัญชีใหม่
type CreateRequest struct {
	Name     string  `json:"name"     binding:"required,max=100"`
	Type     Type    `json:"type"     binding:"required,oneof=asset"`
	Kind     Kind    `json:"kind"     binding:"required"`
	Balance  float64 `json:"balance"  binding:"gte=0"`
	Currency string  `json:"currency"`
}

// UpdateRequest คือ payload สำหรับแก้ไขบัญชี (ฟิลด์ที่เป็น nil = ไม่แก้)
type UpdateRequest struct {
	Name     *string `json:"name"`
	Kind     *Kind   `json:"kind"`
	Currency *string `json:"currency"`
	IsActive *bool   `json:"is_active"`
}
