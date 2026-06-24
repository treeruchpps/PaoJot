package recurring

import (
	"errors"
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5/pgxpool"
)

type Handler struct {
	svc *Service
}

func NewHandler(db *pgxpool.Pool) *Handler {
	return &Handler{svc: NewService(NewRepository(db))}
}

// GET /api/v1/recurring
func (h *Handler) List(c *gin.Context) {
	list, err := h.svc.List(c.Request.Context(), c.GetString("user_id"))
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to fetch recurring"})
		return
	}
	c.JSON(http.StatusOK, list)
}

// POST /api/v1/recurring
func (h *Handler) Create(c *gin.Context) {
	var req CreateRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	rec, err := h.svc.Create(c.Request.Context(), c.GetString("user_id"), req)
	if err != nil {
		if errors.Is(err, ErrInvalidNextDue) {
			c.JSON(http.StatusBadRequest, gin.H{"error": ErrInvalidNextDue.Error()})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to create recurring"})
		return
	}
	c.JSON(http.StatusCreated, rec)
}

// PUT /api/v1/recurring/:id
func (h *Handler) Update(c *gin.Context) {
	var req UpdateRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	rec, err := h.svc.Update(c.Request.Context(), c.Param("id"), c.GetString("user_id"), req)
	if err != nil {
		if errors.Is(err, ErrInvalidNextDue) {
			c.JSON(http.StatusBadRequest, gin.H{"error": ErrInvalidNextDue.Error()})
			return
		}
		c.JSON(http.StatusNotFound, gin.H{"error": "recurring not found"})
		return
	}
	c.JSON(http.StatusOK, rec)
}

// DELETE /api/v1/recurring/:id
func (h *Handler) Delete(c *gin.Context) {
	if err := h.svc.Delete(c.Request.Context(), c.Param("id"), c.GetString("user_id")); err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "recurring not found"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"message": "deleted"})
}
