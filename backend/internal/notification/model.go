package notification

import "time"

type Notification struct {
	ID          string    `json:"id"`
	UserID      string    `json:"user_id"`
	RecurringID *string   `json:"recurring_id"`
	BudgetID    *string   `json:"budget_id"`
	GoalID      *string   `json:"goal_id"`
	Type        string    `json:"notification_type"`
	Title       string    `json:"title"`
	Message     *string   `json:"message"`
	IsRead      bool      `json:"is_read"`
	ActionTaken bool      `json:"action_taken"`
	CreatedAt   time.Time `json:"created_at"`
}
