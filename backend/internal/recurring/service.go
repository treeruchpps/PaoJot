package recurring

import (
	"context"
	"errors"
	"time"
)

var ErrInvalidNextDue = errors.New("invalid next_due_date format")

type Service struct {
	repo *Repository
}

func NewService(repo *Repository) *Service {
	return &Service{repo: repo}
}

func (s *Service) List(ctx context.Context, userID string) ([]RecurringTransaction, error) {
	return s.repo.List(ctx, userID)
}

func (s *Service) Create(ctx context.Context, userID string, req CreateRequest) (RecurringTransaction, error) {
	nextDue, err := time.Parse("2006-01-02", req.NextDueDate)
	if err != nil {
		return RecurringTransaction{}, ErrInvalidNextDue
	}
	return s.repo.Create(ctx, userID, req, nextDue)
}

func (s *Service) Update(ctx context.Context, id, userID string, req UpdateRequest) (RecurringTransaction, error) {
	var nextDuePtr *time.Time
	if req.NextDueDate != nil {
		t, err := time.Parse("2006-01-02", *req.NextDueDate)
		if err != nil {
			return RecurringTransaction{}, ErrInvalidNextDue
		}
		nextDuePtr = &t
	}
	return s.repo.Update(ctx, id, userID, req, nextDuePtr)
}

func (s *Service) Delete(ctx context.Context, id, userID string) error {
	return s.repo.Delete(ctx, id, userID)
}
