package database

import (
	"context"
	"fmt"
	"paomoney/internal/config"

	"github.com/jackc/pgx/v5/pgxpool"
)

func NewPool(cfg *config.DBConfig) (*pgxpool.Pool, error) {
	sslMode := cfg.SSLMode
	if sslMode == "" {
		sslMode = "disable"
	}
	dsn := fmt.Sprintf(
		"postgres://%s:%s@%s:%s/%s?sslmode=%s",
		cfg.User, cfg.Password, cfg.Host, cfg.Port, cfg.Name, sslMode,
	)

	pool, err := pgxpool.New(context.Background(), dsn)
	if err != nil {
		return nil, fmt.Errorf("unable to create connection pool: %w", err)
	}

	if err := pool.Ping(context.Background()); err != nil {
		return nil, fmt.Errorf("unable to connect to database: %w", err)
	}

	return pool, nil
}
