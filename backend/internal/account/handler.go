package account

import (
	"errors"
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Handler เป็นชั้น HTTP — แปลง request/response เท่านั้น ไม่มี business logic หรือ SQL
type Handler struct {
	svc *Service
}

// NewHandler ประกอบชั้น repository → service → handler ให้พร้อมใช้
// router เรียกแค่ account.NewHandler(db) ก็ได้ handler ครบ
func NewHandler(db *pgxpool.Pool) *Handler {
	return &Handler{svc: NewService(NewRepository(db))}
}

// GET /api/v1/accounts
func (h *Handler) List(c *gin.Context) {
	accounts, err := h.svc.List(c.Request.Context(), c.GetString("user_id"))
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to fetch accounts"})
		return
	}
	c.JSON(http.StatusOK, accounts)
}

// POST /api/v1/accounts
func (h *Handler) Create(c *gin.Context) {
	var req CreateRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	a, err := h.svc.Create(c.Request.Context(), c.GetString("user_id"), req)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to create account"})
		return
	}
	c.JSON(http.StatusCreated, a)
}

// GET /api/v1/accounts/:id
func (h *Handler) Get(c *gin.Context) {
	a, err := h.svc.Get(c.Request.Context(), c.Param("id"), c.GetString("user_id"))
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "account not found"})
		return
	}
	c.JSON(http.StatusOK, a)
}

// PUT /api/v1/accounts/:id
func (h *Handler) Update(c *gin.Context) {
	var req UpdateRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	a, err := h.svc.Update(c.Request.Context(), c.Param("id"), c.GetString("user_id"), req)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "account not found"})
		return
	}
	c.JSON(http.StatusOK, a)
}

// DELETE /api/v1/accounts/:id
func (h *Handler) Delete(c *gin.Context) {
	err := h.svc.Delete(c.Request.Context(), c.Param("id"), c.GetString("user_id"))
	if errors.Is(err, ErrNotFound) {
		c.JSON(http.StatusNotFound, gin.H{"error": "account not found"})
		return
	}
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to delete account"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"message": "account deleted"})
}
