package savingsgoal

import "time"

type GoalStatus string

const (
	GoalStatusInProgress GoalStatus = "in_progress"
	GoalStatusCompleted  GoalStatus = "completed"
	GoalStatusCancelled  GoalStatus = "cancelled"
)

type SavingsGoal struct {
	ID            string     `json:"id"`
	UserID        string     `json:"user_id"`
	AccountID     *string    `json:"account_id"`
	Name          string     `json:"name"`
	ImageURL      *string    `json:"image_url"`
	TargetAmount  float64    `json:"target_amount"`
	CurrentAmount float64    `json:"current_amount"`
	StartDate     time.Time  `json:"start_date"`
	Deadline      *time.Time `json:"deadline"`
	Status        GoalStatus `json:"status"`
	CreatedAt     time.Time  `json:"created_at"`
	UpdatedAt     time.Time  `json:"updated_at"`
}

type CreateRequest struct {
	AccountID    *string `json:"account_id"`
	Name         string  `json:"name"           binding:"required,max=100"`
	ImageURL     *string `json:"image_url"`
	TargetAmount float64 `json:"target_amount"  binding:"required,gt=0"`
	StartDate    *string `json:"start_date"`
	Deadline     *string `json:"deadline"`
}

type UpdateRequest struct {
	AccountID     *string     `json:"account_id"`
	Name          *string     `json:"name"`
	ImageURL      *string     `json:"image_url"`
	TargetAmount  *float64    `json:"target_amount"  binding:"omitempty,gt=0"`
	CurrentAmount *float64    `json:"current_amount" binding:"omitempty,gte=0"`
	StartDate     *string     `json:"start_date"`
	Deadline      *string     `json:"deadline"`
	Status        *GoalStatus `json:"status"`
}

type DepositRequest struct {
	FromAccountID string  `json:"from_account_id" binding:"required"`
	Amount        float64 `json:"amount"          binding:"required,gt=0"`
	Note          *string `json:"note"`
	Date          *string `json:"date"`
}

type WithdrawRequest struct {
	ToAccountID string  `json:"to_account_id" binding:"required"`
	Amount      float64 `json:"amount"        binding:"required,gt=0"`
	Note        *string `json:"note"`
	Date        *string `json:"date"`
}

type InitialBalanceRequest struct {
	Amount float64 `json:"amount" binding:"required,gt=0"`
}
