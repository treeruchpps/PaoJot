package savingsgoal

import (
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5/pgxpool"
)

type Handler struct {
	svc *Service
}

func NewHandler(db *pgxpool.Pool) *Handler {
	repo := NewRepository(db)
	repo.EnsureSchema()
	return &Handler{svc: NewService(repo)}
}

// writeErr map httpError → response เดิม (status + message)
func writeErr(c *gin.Context, err error) {
	var he *httpError
	if errors.As(err, &he) {
		c.JSON(he.status, gin.H{"error": he.msg})
		return
	}
	c.JSON(http.StatusInternalServerError, gin.H{"error": "internal error"})
}

// POST /api/v1/savings-goals/images
func (h *Handler) UploadImage(c *gin.Context) {
	file, fh, err := c.Request.FormFile("image")
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "กรุณาเลือกรูปภาพ"})
		return
	}
	defer file.Close()

	mimeType := fh.Header.Get("Content-Type")
	if mimeType != "image/jpeg" && mimeType != "image/png" && mimeType != "image/webp" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "รองรับเฉพาะไฟล์ JPG, PNG หรือ WEBP"})
		return
	}
	if fh.Size > 5*1024*1024 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "รูปภาพต้องมีขนาดไม่เกิน 5MB"})
		return
	}

	data, err := io.ReadAll(file)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "อ่านไฟล์รูปภาพไม่สำเร็จ"})
		return
	}

	uploadsDir := "uploads/goals"
	if err := os.MkdirAll(uploadsDir, 0755); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "สร้างโฟลเดอร์รูปภาพไม่สำเร็จ"})
		return
	}

	ext := ".jpg"
	if mimeType == "image/png" {
		ext = ".png"
	} else if mimeType == "image/webp" {
		ext = ".webp"
	}

	userID := c.GetString("user_id")
	filename := fmt.Sprintf("%s_%d%s", userID[:8], time.Now().UnixNano(), ext)
	filePath := filepath.Join(uploadsDir, filename)
	if err := os.WriteFile(filePath, data, 0644); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "บันทึกรูปภาพไม่สำเร็จ"})
		return
	}

	scheme := "http"
	if c.Request.TLS != nil {
		scheme = "https"
	}
	if forwarded := c.GetHeader("X-Forwarded-Proto"); forwarded != "" {
		scheme = forwarded
	}

	c.JSON(http.StatusOK, gin.H{"image_url": fmt.Sprintf("%s://%s/%s", scheme, c.Request.Host, filepath.ToSlash(filePath))})
}

// GET /api/v1/savings-goals
func (h *Handler) List(c *gin.Context) {
	goals, err := h.svc.List(c.Request.Context(), c.GetString("user_id"))
	if err != nil {
		writeErr(c, err)
		return
	}
	c.JSON(http.StatusOK, goals)
}

// POST /api/v1/savings-goals
func (h *Handler) Create(c *gin.Context) {
	var req CreateRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	g, err := h.svc.Create(c.Request.Context(), c.GetString("user_id"), req)
	if err != nil {
		writeErr(c, err)
		return
	}
	c.JSON(http.StatusCreated, g)
}

// GET /api/v1/savings-goals/:id
func (h *Handler) Get(c *gin.Context) {
	g, err := h.svc.Get(c.Request.Context(), c.Param("id"), c.GetString("user_id"))
	if err != nil {
		writeErr(c, err)
		return
	}
	c.JSON(http.StatusOK, g)
}

// PUT /api/v1/savings-goals/:id
func (h *Handler) Update(c *gin.Context) {
	var req UpdateRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	g, err := h.svc.Update(c.Request.Context(), c.Param("id"), c.GetString("user_id"), req)
	if err != nil {
		writeErr(c, err)
		return
	}
	c.JSON(http.StatusOK, g)
}

// DELETE /api/v1/savings-goals/:id
func (h *Handler) Delete(c *gin.Context) {
	err := h.svc.Delete(c.Request.Context(), c.Param("id"), c.GetString("user_id"), c.Query("refund_account_id"))
	if err != nil {
		writeErr(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"message": "savings goal deleted"})
}

// POST /api/v1/savings-goals/:id/initial-balance
func (h *Handler) AddInitialBalance(c *gin.Context) {
	var req InitialBalanceRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	g, err := h.svc.AddInitialBalance(c.Request.Context(), c.GetString("user_id"), c.Param("id"), req.Amount)
	if err != nil {
		writeErr(c, err)
		return
	}
	c.JSON(http.StatusOK, g)
}

// POST /api/v1/savings-goals/:id/deposit
func (h *Handler) Deposit(c *gin.Context) {
	var req DepositRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	g, err := h.svc.Deposit(c.Request.Context(), c.GetString("user_id"), c.Param("id"), req)
	if err != nil {
		writeErr(c, err)
		return
	}
	c.JSON(http.StatusOK, g)
}

// POST /api/v1/savings-goals/:id/withdraw
func (h *Handler) Withdraw(c *gin.Context) {
	var req WithdrawRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	g, err := h.svc.Withdraw(c.Request.Context(), c.GetString("user_id"), c.Param("id"), req)
	if err != nil {
		writeErr(c, err)
		return
	}
	c.JSON(http.StatusOK, g)
}
