package category

import "context"

type Service struct {
	repo *Repository
}

func NewService(repo *Repository) *Service {
	return &Service{repo: repo}
}

func (s *Service) EnsureDefaults(ctx context.Context) error {
	return s.repo.EnsureDefaults(ctx)
}

func (s *Service) List(ctx context.Context, userID, typeFilter string) ([]Category, error) {
	return s.repo.List(ctx, userID, typeFilter)
}

func (s *Service) Create(ctx context.Context, userID string, req CreateRequest) (Category, error) {
	return s.repo.Create(ctx, userID, req)
}

func (s *Service) Update(ctx context.Context, id, userID string, req UpdateRequest) (Category, error) {
	return s.repo.Update(ctx, id, userID, req)
}

func (s *Service) Delete(ctx context.Context, id, userID string) error {
	return s.repo.Delete(ctx, id, userID)
}
