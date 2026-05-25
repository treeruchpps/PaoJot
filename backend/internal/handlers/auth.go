package handlers

import (
	"context"
	"net/http"
	"paomoney/internal/config"
	"paomoney/internal/middleware"
	"paomoney/internal/models"

	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5/pgxpool"
	"golang.org/x/crypto/bcrypt"
)

type AuthHandler struct {
	db  *pgxpool.Pool
	cfg *config.Config
}

func NewAuthHandler(db *pgxpool.Pool, cfg *config.Config) *AuthHandler {
	return &AuthHandler{db: db, cfg: cfg}
}

// POST /api/v1/auth/register
func (h *AuthHandler) Register(c *gin.Context) {
	var req models.RegisterRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	hash, err := bcrypt.GenerateFromPassword([]byte(req.Password), bcrypt.DefaultCost)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to hash password"})
		return
	}

	var user models.User
	err = h.db.QueryRow(context.Background(),
		`INSERT INTO users (username, email, password_hash)
		 VALUES ($1, $2, $3)
		 RETURNING id, username, email, is_active, created_at, updated_at`,
		req.Username, req.Email, string(hash),
	).Scan(&user.ID, &user.Username, &user.Email, &user.IsActive, &user.CreatedAt, &user.UpdatedAt)

	if err != nil {
		c.JSON(http.StatusConflict, gin.H{"error": "email or username already exists"})
		return
	}

	// อัปเดต week_start_day ใน profile ที่ถูกสร้างอัตโนมัติโดย trigger
	weekStart := req.WeekStartDay
	if weekStart < 0 || weekStart > 6 {
		weekStart = 1 // default: Monday
	}
	h.db.Exec(context.Background(),
		`UPDATE user_profiles SET week_start_day = $1 WHERE user_id = $2`,
		weekStart, user.ID,
	)

	c.JSON(http.StatusCreated, gin.H{
		"message": "registered successfully",
		"user":    user,
	})
}

// POST /api/v1/auth/login
func (h *AuthHandler) Login(c *gin.Context) {
	var req models.LoginRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	var user models.User
	err := h.db.QueryRow(context.Background(),
		`SELECT id, username, email, password_hash, is_active, created_at, updated_at
		 FROM users WHERE email = $1`,
		req.Email,
	).Scan(&user.ID, &user.Username, &user.Email, &user.PasswordHash, &user.IsActive, &user.CreatedAt, &user.UpdatedAt)

	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "invalid email or password"})
		return
	}

	if !user.IsActive {
		c.JSON(http.StatusForbidden, gin.H{"error": "account is disabled"})
		return
	}

	if err := bcrypt.CompareHashAndPassword([]byte(user.PasswordHash), []byte(req.Password)); err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "invalid email or password"})
		return
	}

	access, _ := middleware.GenerateAccessToken(user.ID, user.Email, &h.cfg.JWT)
	refresh, _ := middleware.GenerateRefreshToken(user.ID, user.Email, &h.cfg.JWT)

	c.JSON(http.StatusOK, models.AuthResponse{
		AccessToken:  access,
		RefreshToken: refresh,
		User:         user,
	})
}

// PUT /api/v1/auth/change-password
func (h *AuthHandler) ChangePassword(c *gin.Context) {
	userID := c.GetString("user_id")

	var req struct {
		CurrentPassword string `json:"current_password" binding:"required"`
		NewPassword     string `json:"new_password"     binding:"required,min=8"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	var hash string
	err := h.db.QueryRow(context.Background(),
		`SELECT password_hash FROM users WHERE id = $1`, userID,
	).Scan(&hash)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "user not found"})
		return
	}

	if err := bcrypt.CompareHashAndPassword([]byte(hash), []byte(req.CurrentPassword)); err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "รหัสผ่านปัจจุบันไม่ถูกต้อง"})
		return
	}

	newHash, err := bcrypt.GenerateFromPassword([]byte(req.NewPassword), bcrypt.DefaultCost)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to hash password"})
		return
	}

	_, err = h.db.Exec(context.Background(),
		`UPDATE users SET password_hash = $1 WHERE id = $2`, string(newHash), userID,
	)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to update password"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"message": "เปลี่ยนรหัสผ่านสำเร็จ"})
}

// POST /api/v1/auth/refresh
func (h *AuthHandler) Refresh(c *gin.Context) {
	var req models.RefreshRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	claims, err := middleware.ParseToken(req.RefreshToken, h.cfg.JWT.Secret)
	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "invalid or expired refresh token"})
		return
	}

	access, _ := middleware.GenerateAccessToken(claims.UserID, claims.Email, &h.cfg.JWT)
	refresh, _ := middleware.GenerateRefreshToken(claims.UserID, claims.Email, &h.cfg.JWT)

	c.JSON(http.StatusOK, gin.H{
		"access_token":  access,
		"refresh_token": refresh,
	})
}
