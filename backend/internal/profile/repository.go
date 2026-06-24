package profile

import (
	"context"
	"errors"

	"github.com/jackc/pgx/v5/pgxpool"
)

var ErrNotFound = errors.New("profile not found")

type Repository struct {
	db *pgxpool.Pool
}

func NewRepository(db *pgxpool.Pool) *Repository {
	return &Repository{db: db}
}

// EnsureConsentColumns เติมคอลัมน์ ai_summary_* ถ้ายังไม่มี
func (r *Repository) EnsureConsentColumns(ctx context.Context) {
	_, _ = r.db.Exec(ctx, `
		ALTER TABLE user_profiles
		ADD COLUMN IF NOT EXISTS ai_summary_enabled BOOLEAN NOT NULL DEFAULT FALSE,
		ADD COLUMN IF NOT EXISTS ai_summary_consent_at TIMESTAMPTZ
	`)
}

func (r *Repository) GetByUser(ctx context.Context, userID string) (Profile, error) {
	var p Profile
	err := r.db.QueryRow(ctx,
		`SELECT id, user_id, display_name, avatar_url, week_start_day,
		        ai_summary_enabled, ai_summary_consent_at, created_at, updated_at
		 FROM user_profiles WHERE user_id = $1`,
		userID,
	).Scan(&p.ID, &p.UserID, &p.DisplayName, &p.AvatarURL,
		&p.WeekStartDay, &p.AISummaryEnabled, &p.AISummaryConsentAt,
		&p.CreatedAt, &p.UpdatedAt)
	if err != nil {
		return Profile{}, ErrNotFound
	}
	return p, nil
}

func (r *Repository) Update(ctx context.Context, userID string, req UpdateRequest) (Profile, error) {
	var p Profile
	err := r.db.QueryRow(ctx,
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
	).Scan(&p.ID, &p.UserID, &p.DisplayName, &p.AvatarURL,
		&p.WeekStartDay, &p.AISummaryEnabled, &p.AISummaryConsentAt,
		&p.CreatedAt, &p.UpdatedAt)
	if err != nil {
		return Profile{}, err
	}
	return p, nil
}
