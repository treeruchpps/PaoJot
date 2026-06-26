package config

import (
	"os"
	"strings"
	"time"
)

type Config struct {
	DB      DBConfig
	JWT     JWTConfig
	Server  ServerConfig
	CORS    CORSConfig
	Google  GoogleConfig
	Typhoon TyphoonConfig
	Gemini  GeminiConfig
	R2      R2Config
}

// CORSConfig = รายชื่อ origin ที่อนุญาตให้เรียก API ข้ามโดเมน
type CORSConfig struct {
	AllowedOrigins []string
}

// R2Config = Cloudflare R2 object storage (ถ้าไม่ตั้งค่า ระบบจะ fallback เก็บไฟล์ลง local)
type R2Config struct {
	AccountID string
	AccessKey string
	SecretKey string
	Bucket    string
	PublicURL string
}

type TyphoonConfig struct {
	APIKey       string
	BaseURL      string
	ExtractModel string
}

type GeminiConfig struct {
	APIKey  string
	BaseURL string
	Model   string
}

type GoogleConfig struct {
	ClientID     string
	ClientSecret string
	RedirectURL  string
	FrontendURL  string
}

type DBConfig struct {
	Host     string
	Port     string
	User     string
	Password string
	Name     string
	SSLMode  string
}

type JWTConfig struct {
	Secret         string
	AccessExpires  time.Duration
	RefreshExpires time.Duration
}

type ServerConfig struct {
	Port string
}

func Load() *Config {
	accessExpires, _ := time.ParseDuration(getEnv("JWT_ACCESS_EXPIRES", "15m"))
	refreshExpires, _ := time.ParseDuration(getEnv("JWT_REFRESH_EXPIRES", "168h"))

	return &Config{
		DB: DBConfig{
			Host:     getEnv("DB_HOST", "localhost"),
			Port:     getEnv("DB_PORT", "5432"),
			User:     getEnv("DB_USER", "postgres"),
			Password: getEnv("DB_PASSWORD", "postgres"),
			Name:     getEnv("DB_NAME", "paomoney"),
			// local Postgres ไม่มี SSL → default disable; prod (Supabase) ตั้ง DB_SSLMODE=require
			SSLMode: getEnv("DB_SSLMODE", "disable"),
		},
		JWT: JWTConfig{
			Secret:         getEnv("JWT_SECRET", "secret"),
			AccessExpires:  accessExpires,
			RefreshExpires: refreshExpires,
		},
		Server: ServerConfig{
			// Render กำหนด PORT ให้เอง; local ไม่ตั้งก็ fallback ไป SERVER_PORT แล้ว 8080
			Port: getEnv("PORT", getEnv("SERVER_PORT", "8080")),
		},
		CORS: CORSConfig{
			AllowedOrigins: parseAllowedOrigins(
				getEnv("CORS_ALLOWED_ORIGINS", ""),
				getEnv("FRONTEND_URL", "http://localhost:3000"),
			),
		},
		Google: GoogleConfig{
			ClientID:     getEnv("GOOGLE_CLIENT_ID", ""),
			ClientSecret: getEnv("GOOGLE_CLIENT_SECRET", ""),
			RedirectURL:  getEnv("GOOGLE_REDIRECT_URL", "http://localhost:8080/api/v1/auth/google/callback"),
			FrontendURL:  getEnv("FRONTEND_URL", "http://localhost:3000"),
		},
		Typhoon: TyphoonConfig{
			APIKey:       getEnv("TYPHOON_API_KEY", ""),
			BaseURL:      getEnv("TYPHOON_BASE_URL", "https://api.opentyphoon.ai/v1"),
			ExtractModel: getEnv("TYPHOON_EXTRACT_MODEL", "typhoon-v2.5-30b-a3b-instruct"),
		},
		Gemini: GeminiConfig{
			APIKey:  getEnv("GEMINI_API_KEY", ""),
			BaseURL: getEnv("GEMINI_BASE_URL", "https://generativelanguage.googleapis.com/v1beta/openai"),
			Model:   getEnv("GEMINI_MODEL", "gemini-2.5-flash"),
		},
		R2: R2Config{
			AccountID: getEnv("R2_ACCOUNT_ID", ""),
			AccessKey: getEnv("R2_ACCESS_KEY", ""),
			SecretKey: getEnv("R2_SECRET_KEY", ""),
			Bucket:    getEnv("R2_BUCKET", ""),
			PublicURL: getEnv("R2_PUBLIC_URL", ""),
		},
	}
}

// Endpoint คืน S3 endpoint ของ R2 จาก account id
func (c R2Config) Endpoint() string {
	if c.AccountID == "" {
		return ""
	}
	return "https://" + c.AccountID + ".r2.cloudflarestorage.com"
}

// Enabled = ตั้งค่า R2 ครบหรือยัง (ถ้าไม่ครบจะ fallback ไป local)
func (c R2Config) Enabled() bool {
	return c.AccountID != "" && c.AccessKey != "" && c.SecretKey != "" && c.Bucket != ""
}

func getEnv(key, fallback string) string {
	if val := os.Getenv(key); val != "" {
		return val
	}
	return fallback
}

// parseAllowedOrigins: ถ้าตั้ง CORS_ALLOWED_ORIGINS (คั่นด้วย comma) ใช้ค่านั้น
// ไม่งั้น fallback เป็น FRONTEND_URL (ซึ่ง default = http://localhost:3000)
func parseAllowedOrigins(csv, frontendURL string) []string {
	if strings.TrimSpace(csv) != "" {
		var out []string
		for _, o := range strings.Split(csv, ",") {
			if t := strings.TrimSpace(o); t != "" {
				out = append(out, t)
			}
		}
		if len(out) > 0 {
			return out
		}
	}
	return []string{frontendURL}
}
