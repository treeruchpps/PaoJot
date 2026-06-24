package auth

import (
	"errors"
	"fmt"
	"net/http"

	"paomoney/internal/config"

	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5/pgxpool"
)

type Handler struct {
	svc *Service
	cfg *config.Config
}

func NewHandler(db *pgxpool.Pool, cfg *config.Config) *Handler {
	return &Handler{svc: NewService(NewRepository(db), cfg), cfg: cfg}
}

// POST /api/v1/auth/register
func (h *Handler) Register(c *gin.Context) {
	var req RegisterRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	user, err := h.svc.Register(c.Request.Context(), req)
	if err != nil {
		if errors.Is(err, ErrEmailTaken) {
			c.JSON(http.StatusConflict, gin.H{"error": ErrEmailTaken.Error()})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to hash password"})
		return
	}

	c.JSON(http.StatusCreated, gin.H{
		"message": "registered successfully",
		"user":    user,
	})
}

// POST /api/v1/auth/login
func (h *Handler) Login(c *gin.Context) {
	var req LoginRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	resp, err := h.svc.Login(c.Request.Context(), req)
	if err != nil {
		if errors.Is(err, ErrAccountDisabled) {
			c.JSON(http.StatusForbidden, gin.H{"error": "account is disabled"})
			return
		}
		c.JSON(http.StatusUnauthorized, gin.H{"error": "invalid email or password"})
		return
	}
	c.JSON(http.StatusOK, resp)
}

// PUT /api/v1/auth/change-password
func (h *Handler) ChangePassword(c *gin.Context) {
	var req ChangePasswordRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	err := h.svc.ChangePassword(c.Request.Context(), c.GetString("user_id"), req.CurrentPassword, req.NewPassword)
	if err != nil {
		switch {
		case errors.Is(err, ErrUserNotFound):
			c.JSON(http.StatusNotFound, gin.H{"error": "user not found"})
		case errors.Is(err, ErrWrongPassword):
			c.JSON(http.StatusUnauthorized, gin.H{"error": ErrWrongPassword.Error()})
		case errors.Is(err, ErrHashFailed):
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to hash password"})
		default:
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to update password"})
		}
		return
	}
	c.JSON(http.StatusOK, gin.H{"message": "เปลี่ยนรหัสผ่านสำเร็จ"})
}

// POST /api/v1/auth/refresh
func (h *Handler) Refresh(c *gin.Context) {
	var req RefreshRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	access, refresh, err := h.svc.Refresh(req.RefreshToken)
	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "invalid or expired refresh token"})
		return
	}
	c.JSON(http.StatusOK, gin.H{
		"access_token":  access,
		"refresh_token": refresh,
	})
}

// GET /api/v1/auth/google
func (h *Handler) Redirect(c *gin.Context) {
	c.Redirect(http.StatusTemporaryRedirect, h.svc.GoogleAuthURL())
}

// GET /api/v1/auth/google/callback
func (h *Handler) Callback(c *gin.Context) {
	front := h.cfg.Google.FrontendURL
	code := c.Query("code")
	if code == "" {
		c.Redirect(http.StatusTemporaryRedirect, front+"/login?error=google_failed")
		return
	}

	access, refresh, err := h.svc.GoogleCallback(c.Request.Context(), code)
	if err != nil {
		switch {
		case errors.Is(err, ErrGoogleCreateFailed):
			c.Redirect(http.StatusTemporaryRedirect, front+"/login?error=create_failed")
		case errors.Is(err, ErrAccountDisabled):
			c.Redirect(http.StatusTemporaryRedirect, front+"/login?error=account_disabled")
		default:
			c.Redirect(http.StatusTemporaryRedirect, front+"/login?error=google_failed")
		}
		return
	}

	redirectURL := fmt.Sprintf("%s/auth/callback?access_token=%s&refresh_token=%s", front, access, refresh)
	c.Redirect(http.StatusTemporaryRedirect, redirectURL)
}
