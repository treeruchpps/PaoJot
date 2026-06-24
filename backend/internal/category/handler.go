package category

import (
	"context"
	"errors"
	"log"
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5/pgxpool"
)

type Handler struct {
	svc *Service
}

// NewHandler ประกอบ repo → service → handler และเติมหมวดเริ่มต้นให้ครั้งแรก
func NewHandler(db *pgxpool.Pool) *Handler {
	svc := NewService(NewRepository(db))
	if err := svc.EnsureDefaults(context.Background()); err != nil {
		log.Printf("failed to ensure default categories: %v", err)
	}
	return &Handler{svc: svc}
}

// GET /api/v1/categories
func (h *Handler) List(c *gin.Context) {
	categories, err := h.svc.List(c.Request.Context(), c.GetString("user_id"), c.Query("type"))
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to fetch categories"})
		return
	}
	c.JSON(http.StatusOK, categories)
}

// POST /api/v1/categories
func (h *Handler) Create(c *gin.Context) {
	var req CreateRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	cat, err := h.svc.Create(c.Request.Context(), c.GetString("user_id"), req)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to create category"})
		return
	}
	c.JSON(http.StatusCreated, cat)
}

// PUT /api/v1/categories/:id
func (h *Handler) Update(c *gin.Context) {
	var req UpdateRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	cat, err := h.svc.Update(c.Request.Context(), c.Param("id"), c.GetString("user_id"), req)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "category not found or not editable"})
		return
	}
	c.JSON(http.StatusOK, cat)
}

// DELETE /api/v1/categories/:id
func (h *Handler) Delete(c *gin.Context) {
	if err := h.svc.Delete(c.Request.Context(), c.Param("id"), c.GetString("user_id")); err != nil {
		if errors.Is(err, ErrNotFound) {
			c.JSON(http.StatusNotFound, gin.H{"error": "category not found or not deletable"})
			return
		}
		c.JSON(http.StatusNotFound, gin.H{"error": "category not found or not deletable"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"message": "category deleted"})
}
