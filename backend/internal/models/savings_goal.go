package models

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
	Deadline      *time.Time `json:"deadline"`
	Status        GoalStatus `json:"status"`
	Note          *string    `json:"note"`
	CreatedAt     time.Time  `json:"created_at"`
	UpdatedAt     time.Time  `json:"updated_at"`
}

type CreateSavingsGoalRequest struct {
	AccountID     *string  `json:"account_id"`
	Name          string   `json:"name"           binding:"required,max=100"`
	ImageURL      *string  `json:"image_url"`
	TargetAmount  float64  `json:"target_amount"  binding:"required,gt=0"`
	CurrentAmount float64  `json:"current_amount" binding:"gte=0"`
	Deadline      *string  `json:"deadline"`
	Note          *string  `json:"note"`
}

type UpdateSavingsGoalRequest struct {
	AccountID     *string     `json:"account_id"`
	Name          *string     `json:"name"`
	ImageURL      *string     `json:"image_url"`
	TargetAmount  *float64    `json:"target_amount"  binding:"omitempty,gt=0"`
	CurrentAmount *float64    `json:"current_amount" binding:"omitempty,gte=0"`
	Deadline      *string     `json:"deadline"`
	Status        *GoalStatus `json:"status"`
	Note          *string     `json:"note"`
}
