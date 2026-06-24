package savingsgoal

import "context"

type Service struct {
	repo *Repository
}

func NewService(repo *Repository) *Service {
	return &Service{repo: repo}
}

func (s *Service) List(ctx context.Context, userID string) ([]SavingsGoal, error) {
	return s.repo.List(ctx, userID)
}

func (s *Service) Get(ctx context.Context, id, userID string) (SavingsGoal, error) {
	return s.repo.GetByID(ctx, id, userID)
}

func (s *Service) Create(ctx context.Context, userID string, req CreateRequest) (SavingsGoal, error) {
	return s.repo.Create(ctx, userID, req)
}

func (s *Service) Update(ctx context.Context, id, userID string, req UpdateRequest) (SavingsGoal, error) {
	return s.repo.Update(ctx, id, userID, req)
}

func (s *Service) Delete(ctx context.Context, id, userID, refundAccountID string) error {
	return s.repo.Delete(ctx, id, userID, refundAccountID)
}

func (s *Service) AddInitialBalance(ctx context.Context, userID, goalID string, amount float64) (SavingsGoal, error) {
	return s.repo.AddInitialBalance(ctx, userID, goalID, amount)
}

func (s *Service) Deposit(ctx context.Context, userID, goalID string, req DepositRequest) (SavingsGoal, error) {
	return s.repo.Deposit(ctx, userID, goalID, req)
}

func (s *Service) Withdraw(ctx context.Context, userID, goalID string, req WithdrawRequest) (SavingsGoal, error) {
	return s.repo.Withdraw(ctx, userID, goalID, req)
}
