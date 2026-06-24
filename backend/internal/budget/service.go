package budget

import (
	"context"
	"errors"
)

// sentinel errors ของ business logic — handler ใช้ map เป็น HTTP status
var (
	ErrInvalidStartDate  = errors.New("invalid start_date, use YYYY-MM-DD")
	ErrInvalidEndDate    = errors.New("invalid end_date, use YYYY-MM-DD")
	ErrEndBeforeStart    = errors.New("end_date must be after start_date")
	ErrCategoryRequired  = errors.New("category_id is required")
	ErrDuplicateCategory = errors.New("หมวดหมู่นี้มีงบประมาณประเภทเดียวกันอยู่แล้ว")
)

type Service struct {
	repo *Repository
}

func NewService(repo *Repository) *Service {
	return &Service{repo: repo}
}

func (s *Service) List(ctx context.Context, userID, typeFilter string) ([]Budget, error) {
	s.repo.RefreshWindows(ctx, userID)
	return s.repo.List(ctx, userID, typeFilter)
}

func (s *Service) Get(ctx context.Context, id, userID string) (Budget, error) {
	return s.repo.GetByID(ctx, id, userID)
}

func (s *Service) Create(ctx context.Context, userID string, req CreateRequest) (Budget, error) {
	start, err := parseDate(req.StartDate)
	if err != nil {
		return Budget{}, ErrInvalidStartDate
	}
	end, err := parseDate(req.EndDate)
	if err != nil {
		return Budget{}, ErrInvalidEndDate
	}
	if normalizedStart, normalizedEnd, ok := normalizeRange(req.BudgetType, start, s.repo.WeekStartDay(ctx, userID)); ok {
		start = normalizedStart
		end = normalizedEnd
		req.StartDate = dateString(start)
		req.EndDate = dateString(end)
	}
	if end.Before(start) {
		return Budget{}, ErrEndBeforeStart
	}
	if req.CategoryID == nil || *req.CategoryID == "" {
		return Budget{}, ErrCategoryRequired
	}
	if s.repo.CategoryExists(ctx, userID, *req.CategoryID, req.BudgetType, nil) {
		return Budget{}, ErrDuplicateCategory
	}
	return s.repo.Create(ctx, userID, req)
}

func (s *Service) Update(ctx context.Context, id, userID string, req UpdateRequest) (Budget, error) {
	if req.StartDate != nil {
		if _, err := parseDate(*req.StartDate); err != nil {
			return Budget{}, ErrInvalidStartDate
		}
	}
	if req.EndDate != nil {
		if _, err := parseDate(*req.EndDate); err != nil {
			return Budget{}, ErrInvalidEndDate
		}
	}

	currentCategoryID, currentBudgetType, currentStart, currentEnd, err := s.repo.CurrentForUpdate(ctx, id, userID)
	if err != nil {
		return Budget{}, err
	}

	nextCategoryID := req.CategoryID
	if nextCategoryID == nil {
		nextCategoryID = currentCategoryID
	}
	nextBudgetType := currentBudgetType
	if req.BudgetType != nil {
		nextBudgetType = *req.BudgetType
	}
	nextStart := currentStart
	nextEnd := currentEnd
	if req.StartDate != nil {
		nextStart, _ = parseDate(*req.StartDate)
	}
	if req.EndDate != nil {
		nextEnd, _ = parseDate(*req.EndDate)
	}
	if normalizedStart, normalizedEnd, ok := normalizeRange(nextBudgetType, nextStart, s.repo.WeekStartDay(ctx, userID)); ok {
		nextStart = normalizedStart
		nextEnd = normalizedEnd
		startValue := dateString(nextStart)
		endValue := dateString(nextEnd)
		req.StartDate = &startValue
		req.EndDate = &endValue
	}
	if nextEnd.Before(nextStart) {
		return Budget{}, ErrEndBeforeStart
	}
	if nextCategoryID == nil || *nextCategoryID == "" {
		return Budget{}, ErrCategoryRequired
	}
	if s.repo.CategoryExists(ctx, userID, *nextCategoryID, nextBudgetType, &id) {
		return Budget{}, ErrDuplicateCategory
	}

	return s.repo.Update(ctx, id, userID, nextCategoryID, req.Amount, nextBudgetType, req.StartDate, req.EndDate, req.IsRecurring, req.IsActive)
}

func (s *Service) Delete(ctx context.Context, id, userID string) error {
	return s.repo.Delete(ctx, id, userID)
}
