package profile

import "context"

type Service struct {
	repo *Repository
}

func NewService(repo *Repository) *Service {
	return &Service{repo: repo}
}

func (s *Service) Get(ctx context.Context, userID string) (Profile, error) {
	return s.repo.GetByUser(ctx, userID)
}

func (s *Service) Update(ctx context.Context, userID string, req UpdateRequest) (Profile, error) {
	return s.repo.Update(ctx, userID, req)
}
