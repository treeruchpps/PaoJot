package category

import (
	"context"
	"regexp"
	"strings"
)

type Service struct {
	repo *Repository
}

func NewService(repo *Repository) *Service {
	return &Service{repo: repo}
}

// hexColorRe = #RGB หรือ #RRGGBB เท่านั้น
var hexColorRe = regexp.MustCompile(`^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$`)

// normalizeColor: ตัดช่องว่าง ตรวจรูปแบบ hex ถ้าไม่ถูกต้องคืน nil (ให้ frontend ใช้สีอัตโนมัติแทน)
func normalizeColor(color *string) *string {
	if color == nil {
		return nil
	}
	v := strings.TrimSpace(*color)
	if v == "" || !hexColorRe.MatchString(v) {
		return nil
	}
	v = strings.ToLower(v)
	return &v
}

// normalizeIcon: ตัดช่องว่าง ถ้าว่างคืน nil, จำกัดความยาว 50 ตัวอักษร
func normalizeIcon(icon *string) *string {
	if icon == nil {
		return nil
	}
	v := strings.TrimSpace(*icon)
	if v == "" {
		return nil
	}
	if r := []rune(v); len(r) > 50 {
		v = string(r[:50])
	}
	return &v
}

func (s *Service) EnsureDefaults(ctx context.Context) error {
	return s.repo.EnsureDefaults(ctx)
}

func (s *Service) List(ctx context.Context, userID, typeFilter string) ([]Category, error) {
	return s.repo.List(ctx, userID, typeFilter)
}

func (s *Service) Create(ctx context.Context, userID string, req CreateRequest) (Category, error) {
	req.Icon = normalizeIcon(req.Icon)
	req.Color = normalizeColor(req.Color)
	return s.repo.Create(ctx, userID, req)
}

func (s *Service) Update(ctx context.Context, id, userID string, req UpdateRequest) (Category, error) {
	req.Icon = normalizeIcon(req.Icon)
	req.Color = normalizeColor(req.Color)
	return s.repo.Update(ctx, id, userID, req)
}

func (s *Service) Delete(ctx context.Context, id, userID string) error {
	return s.repo.Delete(ctx, id, userID)
}
