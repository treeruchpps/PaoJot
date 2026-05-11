package handlers

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"

	"paomoney/internal/config"
	"paomoney/internal/middleware"
	"paomoney/internal/models"

	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5/pgxpool"
	"golang.org/x/oauth2"
	"golang.org/x/oauth2/google"
)

type GoogleAuthHandler struct {
	db          *pgxpool.Pool
	cfg         *config.Config
	oauthConfig *oauth2.Config
}

func NewGoogleAuthHandler(db *pgxpool.Pool, cfg *config.Config) *GoogleAuthHandler {
	oauthConfig := &oauth2.Config{
		ClientID:     cfg.Google.ClientID,
		ClientSecret: cfg.Google.ClientSecret,
		RedirectURL:  cfg.Google.RedirectURL,
		Scopes: []string{
			"https://www.googleapis.com/auth/userinfo.email",
			"https://www.googleapis.com/auth/userinfo.profile",
		},
		Endpoint: google.Endpoint,
	}
	return &GoogleAuthHandler{db: db, cfg: cfg, oauthConfig: oauthConfig}
}

// GET /api/v1/auth/google
func (h *GoogleAuthHandler) Redirect(c *gin.Context) {
	url := h.oauthConfig.AuthCodeURL("state", oauth2.AccessTypeOffline)
	c.Redirect(http.StatusTemporaryRedirect, url)
}

// GET /api/v1/auth/google/callback
func (h *GoogleAuthHandler) Callback(c *gin.Context) {
	code := c.Query("code")
	if code == "" {
		c.Redirect(http.StatusTemporaryRedirect, h.cfg.Google.FrontendURL+"/login?error=google_failed")
		return
	}

	// แลก code เป็น token
	token, err := h.oauthConfig.Exchange(context.Background(), code)
	if err != nil {
		c.Redirect(http.StatusTemporaryRedirect, h.cfg.Google.FrontendURL+"/login?error=google_failed")
		return
	}

	// ดึงข้อมูล user จาก Google
	googleUser, err := getGoogleUserInfo(token.AccessToken)
	if err != nil {
		c.Redirect(http.StatusTemporaryRedirect, h.cfg.Google.FrontendURL+"/login?error=google_failed")
		return
	}

	// หา user ในระบบจาก google_id หรือ email
	var user models.User
	err = h.db.QueryRow(context.Background(),
		`SELECT id, username, email, is_active, created_at, updated_at
		 FROM users WHERE google_id = $1 OR email = $2`,
		googleUser.ID, googleUser.Email,
	).Scan(&user.ID, &user.Username, &user.Email, &user.IsActive, &user.CreatedAt, &user.UpdatedAt)

	if err != nil {
		// ไม่พบ user → สร้างใหม่
		username := generateUsername(googleUser.Email)
		err = h.db.QueryRow(context.Background(),
			`INSERT INTO users (username, email, google_id)
			 VALUES ($1, $2, $3)
			 RETURNING id, username, email, is_active, created_at, updated_at`,
			username, googleUser.Email, googleUser.ID,
		).Scan(&user.ID, &user.Username, &user.Email, &user.IsActive, &user.CreatedAt, &user.UpdatedAt)

		if err != nil {
			c.Redirect(http.StatusTemporaryRedirect, h.cfg.Google.FrontendURL+"/login?error=create_failed")
			return
		}

		// อัปเดต display_name และ avatar จาก Google
		h.db.Exec(context.Background(),
			`UPDATE user_profiles SET display_name = $1, avatar_url = $2 WHERE user_id = $3`,
			googleUser.Name, googleUser.Picture, user.ID,
		)
	} else {
		// พบ user เดิม → อัปเดต google_id ถ้ายังไม่มี
		h.db.Exec(context.Background(),
			`UPDATE users SET google_id = $1 WHERE id = $2 AND google_id IS NULL`,
			googleUser.ID, user.ID,
		)
	}

	if !user.IsActive {
		c.Redirect(http.StatusTemporaryRedirect, h.cfg.Google.FrontendURL+"/login?error=account_disabled")
		return
	}

	// ออก JWT เหมือนปกติ
	access, _ := middleware.GenerateAccessToken(user.ID, user.Email, &h.cfg.JWT)
	refresh, _ := middleware.GenerateRefreshToken(user.ID, user.Email, &h.cfg.JWT)

	// Redirect กลับ Frontend พร้อม token
	redirectURL := fmt.Sprintf("%s/auth/callback?access_token=%s&refresh_token=%s",
		h.cfg.Google.FrontendURL, access, refresh)
	c.Redirect(http.StatusTemporaryRedirect, redirectURL)
}

// ---- Helpers ----

type googleUserInfo struct {
	ID      string `json:"id"`
	Email   string `json:"email"`
	Name    string `json:"name"`
	Picture string `json:"picture"`
}

func getGoogleUserInfo(accessToken string) (*googleUserInfo, error) {
	resp, err := http.Get("https://www.googleapis.com/oauth2/v2/userinfo?access_token=" + accessToken)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, err
	}

	var user googleUserInfo
	if err := json.Unmarshal(body, &user); err != nil {
		return nil, err
	}
	return &user, nil
}

func generateUsername(email string) string {
	parts := strings.Split(email, "@")
	return parts[0]
}
