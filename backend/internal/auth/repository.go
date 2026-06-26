package auth

import (
	"context"
	"errors"

	"github.com/jackc/pgx/v5/pgxpool"
)

var ErrUserNotFound = errors.New("user not found")

type Repository struct {
	db *pgxpool.Pool
}

func NewRepository(db *pgxpool.Pool) *Repository {
	return &Repository{db: db}
}

// CreateUser สร้างผู้ใช้ใหม่จาก username/email/hash (อีเมลซ้ำ → error; username ซ้ำได้)
func (r *Repository) CreateUser(ctx context.Context, username, email, passwordHash string) (User, error) {
	var u User
	err := r.db.QueryRow(ctx,
		`INSERT INTO users (username, email, password_hash)
		 VALUES ($1, $2, $3)
		 RETURNING id, username, email, is_active, created_at, updated_at`,
		username, email, passwordHash,
	).Scan(&u.ID, &u.Username, &u.Email, &u.IsActive, &u.CreatedAt, &u.UpdatedAt)
	return u, err
}

// SetWeekStartDay อัปเดตวันเริ่มสัปดาห์ใน profile ที่ถูกสร้างอัตโนมัติโดย trigger (best effort)
func (r *Repository) SetWeekStartDay(ctx context.Context, userID string, weekStart int) {
	r.db.Exec(ctx, //nolint
		`UPDATE user_profiles SET week_start_day = $1 WHERE user_id = $2`,
		weekStart, userID,
	)
}

// GetByEmail คืนผู้ใช้พร้อม password_hash สำหรับตรวจรหัสผ่าน
func (r *Repository) GetByEmail(ctx context.Context, email string) (User, error) {
	var u User
	err := r.db.QueryRow(ctx,
		`SELECT id, username, email, password_hash, is_active, created_at, updated_at
		 FROM users WHERE email = $1`,
		email,
	).Scan(&u.ID, &u.Username, &u.Email, &u.PasswordHash, &u.IsActive, &u.CreatedAt, &u.UpdatedAt)
	return u, err
}

func (r *Repository) GetPasswordHash(ctx context.Context, userID string) (string, error) {
	var hash string
	err := r.db.QueryRow(ctx, `SELECT password_hash FROM users WHERE id = $1`, userID).Scan(&hash)
	if err != nil {
		return "", ErrUserNotFound
	}
	return hash, nil
}

func (r *Repository) UpdatePassword(ctx context.Context, userID, passwordHash string) error {
	_, err := r.db.Exec(ctx,
		`UPDATE users SET password_hash = $1 WHERE id = $2`, passwordHash, userID,
	)
	return err
}

// FindByGoogleOrEmail หาผู้ใช้จาก google_id หรือ email
func (r *Repository) FindByGoogleOrEmail(ctx context.Context, googleID, email string) (User, error) {
	var u User
	err := r.db.QueryRow(ctx,
		`SELECT id, username, email, is_active, created_at, updated_at
		 FROM users WHERE google_id = $1 OR email = $2`,
		googleID, email,
	).Scan(&u.ID, &u.Username, &u.Email, &u.IsActive, &u.CreatedAt, &u.UpdatedAt)
	return u, err
}

func (r *Repository) CreateGoogleUser(ctx context.Context, username, email, googleID string) (User, error) {
	var u User
	err := r.db.QueryRow(ctx,
		`INSERT INTO users (username, email, google_id)
		 VALUES ($1, $2, $3)
		 RETURNING id, username, email, is_active, created_at, updated_at`,
		username, email, googleID,
	).Scan(&u.ID, &u.Username, &u.Email, &u.IsActive, &u.CreatedAt, &u.UpdatedAt)
	return u, err
}

// SetProfileFromGoogle อัปเดตชื่อ/รูปจาก Google (best effort)
func (r *Repository) SetProfileFromGoogle(ctx context.Context, userID, name, picture string) {
	r.db.Exec(ctx, //nolint
		`UPDATE user_profiles SET display_name = $1, avatar_url = $2 WHERE user_id = $3`,
		name, picture, userID,
	)
}

// LinkGoogleID ผูก google_id ให้ผู้ใช้เดิมถ้ายังไม่มี (best effort)
func (r *Repository) LinkGoogleID(ctx context.Context, userID, googleID string) {
	r.db.Exec(ctx, //nolint
		`UPDATE users SET google_id = $1 WHERE id = $2 AND google_id IS NULL`,
		googleID, userID,
	)
}
