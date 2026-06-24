package auth

import (
	"context"
	"errors"

	"paomoney/internal/config"
	"paomoney/internal/middleware"

	"golang.org/x/crypto/bcrypt"
	"golang.org/x/oauth2"
	"golang.org/x/oauth2/google"
)

// sentinel errors — handler ใช้ map เป็น HTTP status / redirect
var (
	ErrEmailTaken         = errors.New("email or username already exists")
	ErrInvalidCredentials = errors.New("invalid email or password")
	ErrAccountDisabled    = errors.New("account is disabled")
	ErrWrongPassword      = errors.New("รหัสผ่านปัจจุบันไม่ถูกต้อง")
	ErrHashFailed         = errors.New("failed to hash password")
	ErrInvalidToken       = errors.New("invalid or expired refresh token")
	ErrGoogleFailed       = errors.New("google sign-in failed")
	ErrGoogleCreateFailed = errors.New("failed to create google user")
)

type Service struct {
	repo  *Repository
	cfg   *config.Config
	oauth *oauth2.Config
}

func NewService(repo *Repository, cfg *config.Config) *Service {
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
	return &Service{repo: repo, cfg: cfg, oauth: oauthConfig}
}

func (s *Service) issueTokens(userID, email string) (string, string) {
	access, _ := middleware.GenerateAccessToken(userID, email, &s.cfg.JWT)
	refresh, _ := middleware.GenerateRefreshToken(userID, email, &s.cfg.JWT)
	return access, refresh
}

func (s *Service) Register(ctx context.Context, req RegisterRequest) (User, error) {
	hash, err := bcrypt.GenerateFromPassword([]byte(req.Password), bcrypt.DefaultCost)
	if err != nil {
		return User{}, ErrHashFailed
	}

	user, err := s.repo.CreateUser(ctx, req.Username, req.Email, string(hash))
	if err != nil {
		return User{}, ErrEmailTaken
	}

	weekStart := req.WeekStartDay
	if weekStart < 0 || weekStart > 6 {
		weekStart = 1 // default: Monday
	}
	s.repo.SetWeekStartDay(ctx, user.ID, weekStart)

	return user, nil
}

func (s *Service) Login(ctx context.Context, req LoginRequest) (AuthResponse, error) {
	user, err := s.repo.GetByEmail(ctx, req.Email)
	if err != nil {
		return AuthResponse{}, ErrInvalidCredentials
	}
	if !user.IsActive {
		return AuthResponse{}, ErrAccountDisabled
	}
	if err := bcrypt.CompareHashAndPassword([]byte(user.PasswordHash), []byte(req.Password)); err != nil {
		return AuthResponse{}, ErrInvalidCredentials
	}

	access, refresh := s.issueTokens(user.ID, user.Email)
	return AuthResponse{AccessToken: access, RefreshToken: refresh, User: user}, nil
}

func (s *Service) ChangePassword(ctx context.Context, userID, current, newPassword string) error {
	hash, err := s.repo.GetPasswordHash(ctx, userID)
	if err != nil {
		return ErrUserNotFound
	}
	if err := bcrypt.CompareHashAndPassword([]byte(hash), []byte(current)); err != nil {
		return ErrWrongPassword
	}
	newHash, err := bcrypt.GenerateFromPassword([]byte(newPassword), bcrypt.DefaultCost)
	if err != nil {
		return ErrHashFailed
	}
	return s.repo.UpdatePassword(ctx, userID, string(newHash))
}

func (s *Service) Refresh(refreshToken string) (string, string, error) {
	claims, err := middleware.ParseToken(refreshToken, s.cfg.JWT.Secret)
	if err != nil {
		return "", "", ErrInvalidToken
	}
	access, refresh := s.issueTokens(claims.UserID, claims.Email)
	return access, refresh, nil
}

func (s *Service) GoogleAuthURL() string {
	return s.oauth.AuthCodeURL("state", oauth2.AccessTypeOffline)
}

// GoogleCallback แลก code → token, หา/สร้าง user, แล้วออก JWT
func (s *Service) GoogleCallback(ctx context.Context, code string) (string, string, error) {
	token, err := s.oauth.Exchange(ctx, code)
	if err != nil {
		return "", "", ErrGoogleFailed
	}

	googleUser, err := getGoogleUserInfo(token.AccessToken)
	if err != nil {
		return "", "", ErrGoogleFailed
	}

	user, err := s.repo.FindByGoogleOrEmail(ctx, googleUser.ID, googleUser.Email)
	if err != nil {
		// ไม่พบ → สร้างใหม่
		username := generateUsername(googleUser.Email)
		user, err = s.repo.CreateGoogleUser(ctx, username, googleUser.Email, googleUser.ID)
		if err != nil {
			return "", "", ErrGoogleCreateFailed
		}
		s.repo.SetProfileFromGoogle(ctx, user.ID, googleUser.Name, googleUser.Picture)
	} else {
		s.repo.LinkGoogleID(ctx, user.ID, googleUser.ID)
	}

	if !user.IsActive {
		return "", "", ErrAccountDisabled
	}

	access, refresh := s.issueTokens(user.ID, user.Email)
	return access, refresh, nil
}
