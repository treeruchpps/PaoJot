package handlers

import (
	"context"
	"net/http"
	"paomoney/internal/models"

	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5/pgxpool"
)

type ProfileHandler struct {
	db *pgxpool.Pool
}

func NewProfileHandler(db *pgxpool.Pool) *ProfileHandler {
	ensureProfileConsentColumns(context.Background(), db)
	return &ProfileHandler{db: db}
}

func ensureProfileConsentColumns(ctx context.Context, db *pgxpool.Pool) {
	_, _ = db.Exec(ctx, `
		ALTER TABLE user_profiles
		ADD COLUMN IF NOT EXISTS ai_summary_enabled BOOLEAN NOT NULL DEFAULT FALSE,
		ADD COLUMN IF NOT EXISTS ai_summary_consent_at TIMESTAMPTZ
	`)
}

// GET /api/v1/profile
func (h *ProfileHandler) GetProfile(c *gin.Context) {
	userID := c.GetString("user_id")

	var profile models.UserProfile
	err := h.db.QueryRow(context.Background(),
		`SELECT id, user_id, display_name, avatar_url, week_start_day,
		        ai_summary_enabled, ai_summary_consent_at, created_at, updated_at
		 FROM user_profiles WHERE user_id = $1`,
		userID,
	).Scan(&profile.ID, &profile.UserID, &profile.DisplayName, &profile.AvatarURL,
		&profile.WeekStartDay, &profile.AISummaryEnabled, &profile.AISummaryConsentAt,
		&profile.CreatedAt, &profile.UpdatedAt)

	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "profile not found"})
		return
	}

	c.JSON(http.StatusOK, profile)
}

// PUT /api/v1/profile
func (h *ProfileHandler) UpdateProfile(c *gin.Context) {
	userID := c.GetString("user_id")

	var req models.UpdateProfileRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	var profile models.UserProfile
	err := h.db.QueryRow(context.Background(),
		`UPDATE user_profiles
		 SET display_name   = COALESCE($1, display_name),
		     avatar_url     = COALESCE($2, avatar_url),
		     week_start_day = COALESCE($3, week_start_day),
		     ai_summary_enabled = COALESCE($4, ai_summary_enabled),
		     ai_summary_consent_at = CASE
		       WHEN $4::boolean IS TRUE AND ai_summary_consent_at IS NULL THEN NOW()
		       WHEN $4::boolean IS FALSE THEN NULL
		       ELSE ai_summary_consent_at
		     END
		 WHERE user_id = $5
		 RETURNING id, user_id, display_name, avatar_url, week_start_day,
		           ai_summary_enabled, ai_summary_consent_at, created_at, updated_at`,
		req.DisplayName, req.AvatarURL, req.WeekStartDay, req.AISummaryEnabled, userID,
	).Scan(&profile.ID, &profile.UserID, &profile.DisplayName, &profile.AvatarURL,
		&profile.WeekStartDay, &profile.AISummaryEnabled, &profile.AISummaryConsentAt,
		&profile.CreatedAt, &profile.UpdatedAt)

	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to update profile"})
		return
	}

	c.JSON(http.StatusOK, profile)
}
