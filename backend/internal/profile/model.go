package profile

import "time"

// Profile คือโปรไฟล์ผู้ใช้ (1 ต่อ 1 กับ users)
type Profile struct {
	ID                 string     `json:"id"`
	UserID             string     `json:"user_id"`
	DisplayName        *string    `json:"display_name"`
	AvatarURL          *string    `json:"avatar_url"`
	WeekStartDay       int        `json:"week_start_day"` // 0=Sun, 1=Mon, 6=Sat
	AISummaryEnabled   bool       `json:"ai_summary_enabled"`
	AISummaryConsentAt *time.Time `json:"ai_summary_consent_at"`
	Onboarded          bool       `json:"onboarded"`
	CreatedAt          time.Time  `json:"created_at"`
	UpdatedAt          time.Time  `json:"updated_at"`
}

type UpdateRequest struct {
	DisplayName      *string `json:"display_name"`
	AvatarURL        *string `json:"avatar_url"`
	WeekStartDay     *int    `json:"week_start_day"`
	AISummaryEnabled *bool   `json:"ai_summary_enabled"`
	Onboarded        *bool   `json:"onboarded"`
}
