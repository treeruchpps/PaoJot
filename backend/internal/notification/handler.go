package notification

import (
	"context"
	"errors"
	"net/http"

	"paomoney/internal/shared/ledger"

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

// GET /api/v1/notifications
func (h *Handler) List(c *gin.Context) {
	list, err := h.svc.List(c.Request.Context(), c.GetString("user_id"))
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to fetch notifications"})
		return
	}
	c.JSON(http.StatusOK, list)
}

// POST /api/v1/notifications/:id/confirm
func (h *Handler) Confirm(c *gin.Context) {
	err := h.svc.Confirm(c.Request.Context(), c.GetString("user_id"), c.Param("id"))
	if err != nil {
		switch {
		case errors.Is(err, ErrNotificationNotFound):
			c.JSON(http.StatusNotFound, gin.H{"error": "notification not found"})
		case errors.Is(err, ErrRecurringNotFound):
			c.JSON(http.StatusNotFound, gin.H{"error": "recurring not found"})
		case errors.Is(err, ledger.ErrInsufficientFunds), errors.Is(err, ledger.ErrAccountNotFound):
			c.JSON(http.StatusBadRequest, gin.H{"error": ledger.ErrorMessage(err)})
		default:
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to confirm"})
		}
		return
	}
	c.JSON(http.StatusOK, gin.H{"message": "confirmed"})
}

// POST /api/v1/notifications/:id/skip
func (h *Handler) Skip(c *gin.Context) {
	if err := h.svc.Skip(c.Request.Context(), c.GetString("user_id"), c.Param("id")); err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "notification not found"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"message": "skipped"})
}

// PUT /api/v1/notifications/read-all
func (h *Handler) ReadAll(c *gin.Context) {
	h.svc.ReadAll(c.Request.Context(), c.GetString("user_id"))
	c.JSON(http.StatusOK, gin.H{"message": "ok"})
}
