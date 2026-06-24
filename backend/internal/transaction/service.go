package transaction

import (
	"context"
	"errors"
	"time"

	"paomoney/internal/shared/types"
)

var (
	ErrInvalidDate        = errors.New("invalid date format, use YYYY-MM-DD")
	ErrTransferToRequired = errors.New("to_account_id required for transfer")
	ErrSameAccount        = errors.New("source and destination accounts must be different")
)

type Service struct {
	repo *Repository
}

func NewService(repo *Repository) *Service {
	return &Service{repo: repo}
}

func (s *Service) List(ctx context.Context, userID string, p ListParams) (ListResult, error) {
	if p.Page < 1 {
		p.Page = 1
	}
	if p.Limit < 1 {
		p.Limit = 20
	}
	if p.Limit > 10000 {
		p.Limit = 10000
	}
	if p.SortDir != "asc" {
		p.SortDir = "desc"
	}

	items, total, income, expense, err := s.repo.List(ctx, userID, p)
	if err != nil {
		return ListResult{}, err
	}

	responseSortBy := p.SortBy
	switch responseSortBy {
	case "amount", "name", "type", "date":
	default:
		responseSortBy = "date"
	}

	return ListResult{
		Items:        items,
		Total:        total,
		TotalIncome:  income,
		TotalExpense: expense,
		Page:         p.Page,
		Limit:        p.Limit,
		SortBy:       responseSortBy,
		SortDir:      p.SortDir,
	}, nil
}

func (s *Service) Get(ctx context.Context, id, userID string) (Transaction, error) {
	return s.repo.GetByID(ctx, id, userID)
}

func (s *Service) Create(ctx context.Context, userID string, req CreateRequest) (Transaction, error) {
	txDate := time.Now()
	if req.TransactionDate != nil {
		parsed, err := time.Parse("2006-01-02", *req.TransactionDate)
		if err != nil {
			return Transaction{}, ErrInvalidDate
		}
		txDate = parsed
	}

	if req.Type == types.TransactionTypeTransfer {
		if req.ToAccountID == nil {
			return Transaction{}, ErrTransferToRequired
		}
		if *req.ToAccountID == req.AccountID {
			return Transaction{}, ErrSameAccount
		}
	}

	return s.repo.Create(ctx, userID, req, txDate)
}

func (s *Service) Update(ctx context.Context, id, userID string, req UpdateRequest) (Transaction, error) {
	var txDate *time.Time
	if req.TransactionDate != nil {
		parsed, err := time.Parse("2006-01-02", *req.TransactionDate)
		if err != nil {
			return Transaction{}, ErrInvalidDate
		}
		txDate = &parsed
	}
	return s.repo.Update(ctx, id, userID, req, txDate)
}

func (s *Service) Delete(ctx context.Context, id, userID string) error {
	return s.repo.Delete(ctx, id, userID)
}
