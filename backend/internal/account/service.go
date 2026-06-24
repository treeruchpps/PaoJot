package account

import "context"

// Service เป็นชั้น business logic — กฎเกณฑ์/ค่า default อยู่ที่นี่ ไม่ปนกับ SQL หรือ HTTP
type Service struct {
	repo *Repository
}

func NewService(repo *Repository) *Service {
	return &Service{repo: repo}
}

func (s *Service) List(ctx context.Context, userID string) ([]Account, error) {
	return s.repo.ListByUser(ctx, userID)
}

func (s *Service) Get(ctx context.Context, id, userID string) (Account, error) {
	return s.repo.GetByID(ctx, id, userID)
}

func (s *Service) Create(ctx context.Context, userID string, req CreateRequest) (Account, error) {
	// ค่า default ของธุรกิจ: สกุลเงิน THB และบังคับ type เป็น asset
	if req.Currency == "" {
		req.Currency = "THB"
	}
	req.Type = TypeAsset
	return s.repo.Create(ctx, userID, req)
}

func (s *Service) Update(ctx context.Context, id, userID string, req UpdateRequest) (Account, error) {
	return s.repo.Update(ctx, id, userID, req)
}

func (s *Service) Delete(ctx context.Context, id, userID string) error {
	return s.repo.SoftDelete(ctx, id, userID)
}
