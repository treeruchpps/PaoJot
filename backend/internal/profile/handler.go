package profile

import (
	"context"
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5/pgxpool"
)

type Handler struct {
	svc *Service
}

func NewHandler(db *pgxpool.Pool) *Handler {
	repo := NewRepository(db)
	repo.EnsureConsentColumns(context.Background())
	return &Handler{svc: NewService(repo)}
}

// GET /api/v1/profile
func (h *Handler) GetProfile(c *gin.Context) {
	p, err := h.svc.Get(c.Request.Context(), c.GetString("user_id"))
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "profile not found"})
		return
	}
	c.JSON(http.StatusOK, p)
}

// PUT /api/v1/profile
func (h *Handler) UpdateProfile(c *gin.Context) {
	var req UpdateRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	p, err := h.svc.Update(c.Request.Context(), c.GetString("user_id"), req)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to update profile"})
		return
	}
	c.JSON(http.StatusOK, p)
}
