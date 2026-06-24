package notification

import (
	"context"
	"time"
)

type Service struct {
	repo *Repository
}

func NewService(repo *Repository) *Service {
	return &Service{repo: repo}
}

// List สร้าง notification จากแหล่งต่างๆ ที่ครบเงื่อนไข แล้วคืน 5 รายการล่าสุด
func (s *Service) List(ctx context.Context, userID string) ([]Notification, error) {
	today := time.Now().Truncate(24 * time.Hour)
	s.repo.GenerateRecurring(ctx, userID, today)
	s.repo.GenerateBudget(ctx, userID)
	s.repo.GenerateGoal(ctx, userID)
	s.repo.GenerateAISummary(ctx, userID)
	s.repo.Prune(ctx, userID)
	return s.repo.ListLatest(ctx, userID)
}

func (s *Service) Confirm(ctx context.Context, userID, notiID string) error {
	return s.repo.Confirm(ctx, userID, notiID)
}

func (s *Service) Skip(ctx context.Context, userID, notiID string) error {
	return s.repo.Skip(ctx, userID, notiID)
}

func (s *Service) ReadAll(ctx context.Context, userID string) {
	s.repo.ReadAll(ctx, userID)
}
