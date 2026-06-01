package handlers

import (
	"context"
	"net/http"
	"paomoney/internal/models"

	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5/pgxpool"
)

type AccountHandler struct {
	db *pgxpool.Pool
}

func NewAccountHandler(db *pgxpool.Pool) *AccountHandler {
	return &AccountHandler{db: db}
}

// GET /api/v1/accounts
func (h *AccountHandler) List(c *gin.Context) {
	userID := c.GetString("user_id")

	rows, err := h.db.Query(context.Background(),
		`SELECT id, user_id, name, type, kind, balance, currency, is_active, created_at, updated_at
		 FROM accounts WHERE user_id = $1 AND is_active = true AND type = 'asset' ORDER BY created_at ASC`,
		userID,
	)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to fetch accounts"})
		return
	}
	defer rows.Close()

	accounts := []models.Account{}
	for rows.Next() {
		var a models.Account
		if err := rows.Scan(&a.ID, &a.UserID, &a.Name, &a.Type, &a.Kind, &a.Balance, &a.Currency, &a.IsActive, &a.CreatedAt, &a.UpdatedAt); err != nil {
			continue
		}
		accounts = append(accounts, a)
	}

	c.JSON(http.StatusOK, accounts)
}

// POST /api/v1/accounts
func (h *AccountHandler) Create(c *gin.Context) {
	userID := c.GetString("user_id")

	var req models.CreateAccountRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	if req.Currency == "" {
		req.Currency = "THB"
	}
	req.Type = models.AccountTypeAsset

	var a models.Account
	err := h.db.QueryRow(context.Background(),
		`INSERT INTO accounts (user_id, name, type, kind, balance, currency)
		 VALUES ($1, $2, $3, $4, $5, $6)
		 RETURNING id, user_id, name, type, kind, balance, currency, is_active, created_at, updated_at`,
		userID, req.Name, req.Type, req.Kind, req.Balance, req.Currency,
	).Scan(&a.ID, &a.UserID, &a.Name, &a.Type, &a.Kind, &a.Balance, &a.Currency, &a.IsActive, &a.CreatedAt, &a.UpdatedAt)

	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to create account"})
		return
	}

	c.JSON(http.StatusCreated, a)
}

// GET /api/v1/accounts/:id
func (h *AccountHandler) Get(c *gin.Context) {
	userID := c.GetString("user_id")
	id := c.Param("id")

	var a models.Account
	err := h.db.QueryRow(context.Background(),
		`SELECT id, user_id, name, type, kind, balance, currency, is_active, created_at, updated_at
		 FROM accounts WHERE id = $1 AND user_id = $2`,
		id, userID,
	).Scan(&a.ID, &a.UserID, &a.Name, &a.Type, &a.Kind, &a.Balance, &a.Currency, &a.IsActive, &a.CreatedAt, &a.UpdatedAt)

	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "account not found"})
		return
	}

	c.JSON(http.StatusOK, a)
}

// PUT /api/v1/accounts/:id
func (h *AccountHandler) Update(c *gin.Context) {
	userID := c.GetString("user_id")
	id := c.Param("id")

	var req models.UpdateAccountRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	var a models.Account
	err := h.db.QueryRow(context.Background(),
		`UPDATE accounts
		 SET name      = COALESCE($1, name),
		     kind      = COALESCE($2, kind),
		     currency  = COALESCE($3, currency),
		     is_active = COALESCE($4, is_active)
		 WHERE id = $5 AND user_id = $6
		 RETURNING id, user_id, name, type, kind, balance, currency, is_active, created_at, updated_at`,
		req.Name, req.Kind, req.Currency, req.IsActive, id, userID,
	).Scan(&a.ID, &a.UserID, &a.Name, &a.Type, &a.Kind, &a.Balance, &a.Currency, &a.IsActive, &a.CreatedAt, &a.UpdatedAt)

	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "account not found"})
		return
	}

	c.JSON(http.StatusOK, a)
}

// DELETE /api/v1/accounts/:id
func (h *AccountHandler) Delete(c *gin.Context) {
	userID := c.GetString("user_id")
	id := c.Param("id")
	ctx := context.Background()

	dbTx, err := h.db.Begin(ctx)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to start transaction"})
		return
	}
	defer dbTx.Rollback(ctx)

	var exists bool
	if err := dbTx.QueryRow(ctx,
		`SELECT EXISTS(SELECT 1 FROM accounts WHERE id = $1 AND user_id = $2 AND is_active = true)`,
		id, userID,
	).Scan(&exists); err != nil || !exists {
		c.JSON(http.StatusNotFound, gin.H{"error": "account not found"})
		return
	}

	if _, err := dbTx.Exec(ctx,
		`UPDATE accounts a
		 SET balance = a.balance - t.amount
		 FROM transactions t
		 WHERE t.user_id = $1
		   AND t.type = 'transfer'
		   AND t.account_id = $2
		   AND t.to_account_id = a.id
		   AND a.user_id = $1
		   AND a.id <> $2`,
		userID, id,
	); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to reverse destination account balances"})
		return
	}

	if _, err := dbTx.Exec(ctx,
		`UPDATE accounts a
		 SET balance = a.balance + t.amount
		 FROM transactions t
		 WHERE t.user_id = $1
		   AND t.type = 'transfer'
		   AND t.to_account_id = $2
		   AND t.account_id = a.id
		   AND a.user_id = $1
		   AND a.id <> $2`,
		userID, id,
	); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to reverse source account balances"})
		return
	}

	if _, err := dbTx.Exec(ctx,
		`DELETE FROM transactions
		 WHERE user_id = $1 AND (account_id = $2 OR to_account_id = $2)`,
		userID, id,
	); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to delete account transactions"})
		return
	}

	if _, err := dbTx.Exec(ctx,
		`DELETE FROM recurring_transactions
		 WHERE user_id = $1 AND (account_id = $2 OR to_account_id = $2)`,
		userID, id,
	); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to delete recurring transactions"})
		return
	}

	if _, err := dbTx.Exec(ctx,
		`DELETE FROM savings_goals WHERE user_id = $1 AND account_id = $2`,
		userID, id,
	); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to delete linked savings goals"})
		return
	}

	result, err := dbTx.Exec(ctx,
		`UPDATE accounts SET is_active = false WHERE id = $1 AND user_id = $2`,
		id, userID,
	)
	if err != nil || result.RowsAffected() == 0 {
		c.JSON(http.StatusNotFound, gin.H{"error": "account not found"})
		return
	}

	if err := dbTx.Commit(ctx); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to commit account delete"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"message": "account deleted"})
}
