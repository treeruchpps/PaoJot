package budget

import (
	"context"
	"errors"
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5/pgxpool"
)

type Handler struct {
	svc *Service
}

func NewHandler(db *pgxpool.Pool) *Handler {
	repo := NewRepository(db)
	_ = repo.EnsureSchema(context.Background())
	return &Handler{svc: NewService(repo)}
}

// validationStatus map sentinel error → HTTP status; คืน 0 ถ้าไม่ใช่ error ที่รู้จัก
func validationStatus(err error) int {
	switch {
	case errors.Is(err, ErrInvalidStartDate),
		errors.Is(err, ErrInvalidEndDate),
		errors.Is(err, ErrEndBeforeStart),
		errors.Is(err, ErrCategoryRequired):
		return http.StatusBadRequest
	case errors.Is(err, ErrDuplicateCategory):
		return http.StatusConflict
	case errors.Is(err, ErrNotFound):
		return http.StatusNotFound
	default:
		return 0
	}
}

// GET /api/v1/budgets
func (h *Handler) List(c *gin.Context) {
	budgets, err := h.svc.List(c.Request.Context(), c.GetString("user_id"), c.Query("type"))
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to fetch budgets"})
		return
	}
	c.JSON(http.StatusOK, budgets)
}

// POST /api/v1/budgets
func (h *Handler) Create(c *gin.Context) {
	var req CreateRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	b, err := h.svc.Create(c.Request.Context(), c.GetString("user_id"), req)
	if err != nil {
		if status := validationStatus(err); status == http.StatusNotFound {
			c.JSON(http.StatusNotFound, gin.H{"error": "budget not found"})
		} else if status != 0 {
			c.JSON(status, gin.H{"error": err.Error()})
		} else {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to create budget"})
		}
		return
	}
	c.JSON(http.StatusCreated, b)
}

// GET /api/v1/budgets/:id
func (h *Handler) Get(c *gin.Context) {
	b, err := h.svc.Get(c.Request.Context(), c.Param("id"), c.GetString("user_id"))
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "budget not found"})
		return
	}
	c.JSON(http.StatusOK, b)
}

// PUT /api/v1/budgets/:id
func (h *Handler) Update(c *gin.Context) {
	var req UpdateRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	b, err := h.svc.Update(c.Request.Context(), c.Param("id"), c.GetString("user_id"), req)
	if err != nil {
		switch validationStatus(err) {
		case http.StatusBadRequest, http.StatusConflict:
			c.JSON(validationStatus(err), gin.H{"error": err.Error()})
		default:
			c.JSON(http.StatusNotFound, gin.H{"error": "budget not found"})
		}
		return
	}
	c.JSON(http.StatusOK, b)
}

// DELETE /api/v1/budgets/:id
func (h *Handler) Delete(c *gin.Context) {
	if err := h.svc.Delete(c.Request.Context(), c.Param("id"), c.GetString("user_id")); err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "budget not found"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"message": "budget deleted"})
}
