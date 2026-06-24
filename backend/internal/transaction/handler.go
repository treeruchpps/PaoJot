package transaction

import (
	"errors"
	"net/http"
	"strconv"
	"strings"

	"paomoney/internal/shared/ledger"

	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5/pgxpool"
)

type Handler struct {
	svc *Service
}

func NewHandler(db *pgxpool.Pool) *Handler {
	return &Handler{svc: NewService(NewRepository(db))}
}

// writeError map error → HTTP status ที่เหมาะสม
func (h *Handler) writeError(c *gin.Context, err error, genericMsg string) {
	switch {
	case errors.Is(err, ErrNotFound):
		c.JSON(http.StatusNotFound, gin.H{"error": "transaction not found"})
	case errors.Is(err, ErrInvalidDate), errors.Is(err, ErrTransferToRequired), errors.Is(err, ErrSameAccount):
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
	case errors.Is(err, ledger.ErrInsufficientFunds), errors.Is(err, ledger.ErrAccountNotFound):
		c.JSON(http.StatusBadRequest, gin.H{"error": ledger.ErrorMessage(err)})
	default:
		c.JSON(http.StatusInternalServerError, gin.H{"error": genericMsg})
	}
}

// GET /api/v1/transactions
func (h *Handler) List(c *gin.Context) {
	p := ListParams{
		AccountID:   c.Query("account_id"),
		Type:        c.Query("type"),
		DateFrom:    c.Query("date_from"),
		DateTo:      c.Query("date_to"),
		Search:      strings.TrimSpace(c.Query("search")),
		IncludeGoal: c.Query("include_goal") == "true",
		SortBy:      c.DefaultQuery("sort_by", "date"),
		SortDir:     strings.ToLower(c.DefaultQuery("sort_dir", "desc")),
	}
	p.Page, _ = strconv.Atoi(c.DefaultQuery("page", "1"))
	p.Limit, _ = strconv.Atoi(c.DefaultQuery("limit", "20"))

	res, err := h.svc.List(c.Request.Context(), c.GetString("user_id"), p)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to fetch transactions"})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"data":          res.Items,
		"page":          res.Page,
		"limit":         res.Limit,
		"total":         res.Total,
		"total_income":  res.TotalIncome,
		"total_expense": res.TotalExpense,
		"sort_by":       res.SortBy,
		"sort_dir":      res.SortDir,
	})
}

// POST /api/v1/transactions
func (h *Handler) Create(c *gin.Context) {
	var req CreateRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	t, err := h.svc.Create(c.Request.Context(), c.GetString("user_id"), req)
	if err != nil {
		h.writeError(c, err, "failed to create transaction")
		return
	}
	c.JSON(http.StatusCreated, t)
}

// GET /api/v1/transactions/:id
func (h *Handler) Get(c *gin.Context) {
	t, err := h.svc.Get(c.Request.Context(), c.Param("id"), c.GetString("user_id"))
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "transaction not found"})
		return
	}
	c.JSON(http.StatusOK, t)
}

// PUT /api/v1/transactions/:id
func (h *Handler) Update(c *gin.Context) {
	var req UpdateRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	t, err := h.svc.Update(c.Request.Context(), c.Param("id"), c.GetString("user_id"), req)
	if err != nil {
		h.writeError(c, err, "failed to update transaction")
		return
	}
	c.JSON(http.StatusOK, t)
}

// DELETE /api/v1/transactions/:id
func (h *Handler) Delete(c *gin.Context) {
	if err := h.svc.Delete(c.Request.Context(), c.Param("id"), c.GetString("user_id")); err != nil {
		h.writeError(c, err, "failed to delete transaction")
		return
	}
	c.JSON(http.StatusOK, gin.H{"message": "transaction deleted"})
}
