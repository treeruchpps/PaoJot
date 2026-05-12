package config

import (
	"os"
	"time"
)

type Config struct {
	DB      DBConfig
	JWT     JWTConfig
	Server  ServerConfig
	Google  GoogleConfig
	Typhoon TyphoonConfig
}

type TyphoonConfig struct {
	APIKey       string
	BaseURL      string
	ExtractModel string
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
		},
		JWT: JWTConfig{
			Secret:         getEnv("JWT_SECRET", "secret"),
			AccessExpires:  accessExpires,
			RefreshExpires: refreshExpires,
		},
		Server: ServerConfig{
			Port: getEnv("SERVER_PORT", "8080"),
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
	}
}

func getEnv(key, fallback string) string {
	if val := os.Getenv(key); val != "" {
		return val
	}
	return fallback
}
