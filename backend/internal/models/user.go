package models

import "time"

type User struct {
	ID           string    `json:"id"`
	Username     string    `json:"username"`
	Email        string    `json:"email"`
	PasswordHash string    `json:"-"`
	IsActive     bool      `json:"is_active"`
	CreatedAt    time.Time `json:"created_at"`
	UpdatedAt    time.Time `json:"updated_at"`
}

type UserProfile struct {
	ID                 string     `json:"id"`
	UserID             string     `json:"user_id"`
	DisplayName        *string    `json:"display_name"`
	AvatarURL          *string    `json:"avatar_url"`
	WeekStartDay       int        `json:"week_start_day"` // 0=Sun, 1=Mon, 6=Sat
	AISummaryEnabled   bool       `json:"ai_summary_enabled"`
	AISummaryConsentAt *time.Time `json:"ai_summary_consent_at"`
	CreatedAt          time.Time  `json:"created_at"`
	UpdatedAt          time.Time  `json:"updated_at"`
}

type RegisterRequest struct {
	Username     string `json:"username"       binding:"required,min=3,max=50"`
	Email        string `json:"email"          binding:"required,email"`
	Password     string `json:"password"       binding:"required,min=8"`
	WeekStartDay int    `json:"week_start_day"` // 0=Sun, 1=Mon (default), 6=Sat
}

type LoginRequest struct {
	Email    string `json:"email"    binding:"required,email"`
	Password string `json:"password" binding:"required"`
}

type AuthResponse struct {
	AccessToken  string `json:"access_token"`
	RefreshToken string `json:"refresh_token"`
	User         User   `json:"user"`
}

type RefreshRequest struct {
	RefreshToken string `json:"refresh_token" binding:"required"`
}

type UpdateProfileRequest struct {
	DisplayName      *string `json:"display_name"`
	AvatarURL        *string `json:"avatar_url"`
	WeekStartDay     *int    `json:"week_start_day"`
	AISummaryEnabled *bool   `json:"ai_summary_enabled"`
}
