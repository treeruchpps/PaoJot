package handlers

import (
	"context"
	"net/http"
	"paomoney/internal/models"
	"strconv"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5/pgxpool"
)

type TransactionHandler struct {
	db *pgxpool.Pool
}

func NewTransactionHandler(db *pgxpool.Pool) *TransactionHandler {
	return &TransactionHandler{db: db}
}

// GET /api/v1/transactions
func (h *TransactionHandler) List(c *gin.Context) {
	userID := c.GetString("user_id")

	page, _ := strconv.Atoi(c.DefaultQuery("page", "1"))
	limit, _ := strconv.Atoi(c.DefaultQuery("limit", "20"))
	if page < 1 {
		page = 1
	}
	if limit < 1 {
		limit = 20
	}
	if limit > 10000 {
		limit = 10000
	}
	offset := (page - 1) * limit

	accountID := c.Query("account_id")
	txType := c.Query("type")
	dateFrom := c.Query("date_from")
	dateTo := c.Query("date_to")

	query := `SELECT id, user_id, account_id, to_account_id, category_id, type, amount, name, note, transaction_date, is_recurring, created_at, updated_at
			  FROM transactions WHERE user_id = $1`
	args := []interface{}{userID}
	idx := 2

	if accountID != "" {
		query += " AND account_id = $" + strconv.Itoa(idx)
		args = append(args, accountID)
		idx++
	}
	if txType != "" {
		query += " AND type = $" + strconv.Itoa(idx)
		args = append(args, txType)
		idx++
	}
	if dateFrom != "" {
		query += " AND transaction_date >= $" + strconv.Itoa(idx)
		args = append(args, dateFrom)
		idx++
	}
	if dateTo != "" {
		query += " AND transaction_date <= $" + strconv.Itoa(idx)
		args = append(args, dateTo)
		idx++
	}

	query += " ORDER BY transaction_date DESC, created_at DESC"
	query += " LIMIT $" + strconv.Itoa(idx) + " OFFSET $" + strconv.Itoa(idx+1)
	args = append(args, limit, offset)

	rows, err := h.db.Query(context.Background(), query, args...)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to fetch transactions"})
		return
	}
	defer rows.Close()

	transactions := []models.Transaction{}
	for rows.Next() {
		var t models.Transaction
		if err := rows.Scan(&t.ID, &t.UserID, &t.AccountID, &t.ToAccountID, &t.CategoryID,
			&t.Type, &t.Amount, &t.Name, &t.Note, &t.TransactionDate, &t.IsRecurring, &t.CreatedAt, &t.UpdatedAt); err != nil {
			continue
		}
		transactions = append(transactions, t)
	}

	c.JSON(http.StatusOK, gin.H{
		"data":  transactions,
		"page":  page,
		"limit": limit,
	})
}

// POST /api/v1/transactions
// สร้าง transaction พร้อมอัปเดต balance ของบัญชีใน DB transaction เดียวกัน
func (h *TransactionHandler) Create(c *gin.Context) {
	userID := c.GetString("user_id")

	var req models.CreateTransactionRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	txDate := time.Now()
	if req.TransactionDate != nil {
		parsed, err := time.Parse("2006-01-02", *req.TransactionDate)
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid date format, use YYYY-MM-DD"})
			return
		}
		txDate = parsed
	}

	// เริ่ม DB transaction
	ctx := context.Background()
	dbTx, err := h.db.Begin(ctx)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to begin transaction"})
		return
	}
	defer dbTx.Rollback(ctx)

	// Insert transaction record
	var t models.Transaction
	err = dbTx.QueryRow(ctx,
		`INSERT INTO transactions (user_id, account_id, to_account_id, category_id, type, amount, name, note, transaction_date, is_recurring)
		 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, FALSE)
		 RETURNING id, user_id, account_id, to_account_id, category_id, type, amount, name, note, transaction_date, is_recurring, created_at, updated_at`,
		userID, req.AccountID, req.ToAccountID, req.CategoryID, req.Type, req.Amount, req.Name, req.Note, txDate,
	).Scan(&t.ID, &t.UserID, &t.AccountID, &t.ToAccountID, &t.CategoryID,
		&t.Type, &t.Amount, &t.Name, &t.Note, &t.TransactionDate, &t.IsRecurring, &t.CreatedAt, &t.UpdatedAt)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to create transaction"})
		return
	}

	// อัปเดต balance ตามประเภท
	switch req.Type {
	case models.TransactionTypeIncome:
		// รายรับ: เพิ่ม balance
		_, err = dbTx.Exec(ctx,
			`UPDATE accounts SET balance = balance + $1 WHERE id = $2 AND user_id = $3`,
			req.Amount, req.AccountID, userID,
		)
	case models.TransactionTypeExpense:
		// รายจ่าย: ลด balance
		_, err = dbTx.Exec(ctx,
			`UPDATE accounts SET balance = balance - $1 WHERE id = $2 AND user_id = $3`,
			req.Amount, req.AccountID, userID,
		)
	case models.TransactionTypeTransfer:
		// โอนเงิน: ลดจากต้นทางเสมอ
		if req.ToAccountID == nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "to_account_id required for transfer"})
			return
		}
		if *req.ToAccountID == req.AccountID {
			c.JSON(http.StatusBadRequest, gin.H{"error": "source and destination accounts must be different"})
			return
		}
		_, err = dbTx.Exec(ctx,
			`UPDATE accounts SET balance = balance - $1 WHERE id = $2 AND user_id = $3`,
			req.Amount, req.AccountID, userID,
		)
		if err == nil {
			_, err = dbTx.Exec(ctx,
				`UPDATE accounts SET balance = balance + $1 WHERE id = $2 AND user_id = $3`,
				req.Amount, *req.ToAccountID, userID,
			)
		}
	case models.TransactionTypeAdjustment:
		// ปรับยอด: บันทึกเพื่อ audit trail เท่านั้น ไม่เปลี่ยน balance
	}

	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to update account balance"})
		return
	}

	if err := dbTx.Commit(ctx); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to commit transaction"})
		return
	}

	c.JSON(http.StatusCreated, t)
}

// GET /api/v1/transactions/:id
func (h *TransactionHandler) Get(c *gin.Context) {
	userID := c.GetString("user_id")
	id := c.Param("id")

	var t models.Transaction
	err := h.db.QueryRow(context.Background(),
		`SELECT id, user_id, account_id, to_account_id, category_id, type, amount, name, note, transaction_date, is_recurring, created_at, updated_at
		 FROM transactions WHERE id = $1 AND user_id = $2`,
		id, userID,
	).Scan(&t.ID, &t.UserID, &t.AccountID, &t.ToAccountID, &t.CategoryID,
		&t.Type, &t.Amount, &t.Name, &t.Note, &t.TransactionDate, &t.IsRecurring, &t.CreatedAt, &t.UpdatedAt)

	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "transaction not found"})
		return
	}

	c.JSON(http.StatusOK, t)
}

// PUT /api/v1/transactions/:id
// reverse balance เดิม → update row → apply balance ใหม่ (ในธุรกรรมเดียวกัน)
func (h *TransactionHandler) Update(c *gin.Context) {
	userID := c.GetString("user_id")
	id := c.Param("id")

	var req models.UpdateTransactionRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	var txDate *time.Time
	if req.TransactionDate != nil {
		parsed, err := time.Parse("2006-01-02", *req.TransactionDate)
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid date format, use YYYY-MM-DD"})
			return
		}
		txDate = &parsed
	}

	ctx := context.Background()

	// 1. ดึงข้อมูล transaction เดิมเพื่อ reverse balance
	var old models.Transaction
	err := h.db.QueryRow(ctx,
		`SELECT id, user_id, account_id, to_account_id, type, amount FROM transactions WHERE id = $1 AND user_id = $2`,
		id, userID,
	).Scan(&old.ID, &old.UserID, &old.AccountID, &old.ToAccountID, &old.Type, &old.Amount)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "transaction not found"})
		return
	}
	if old.Type == models.TransactionTypeTransfer && old.ToAccountID != nil && *old.ToAccountID == old.AccountID {
		c.JSON(http.StatusBadRequest, gin.H{"error": "source and destination accounts must be different"})
		return
	}

	// 2. เริ่ม DB transaction
	dbTx, err := h.db.Begin(ctx)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to begin transaction"})
		return
	}
	defer dbTx.Rollback(ctx)

	// 3. Reverse balance เดิม (เหมือน delete)
	switch old.Type {
	case models.TransactionTypeIncome:
		_, err = dbTx.Exec(ctx,
			`UPDATE accounts SET balance = balance - $1 WHERE id = $2 AND user_id = $3`,
			old.Amount, old.AccountID, userID,
		)
	case models.TransactionTypeExpense:
		_, err = dbTx.Exec(ctx,
			`UPDATE accounts SET balance = balance + $1 WHERE id = $2 AND user_id = $3`,
			old.Amount, old.AccountID, userID,
		)
	case models.TransactionTypeTransfer:
		if old.ToAccountID != nil {
			_, err = dbTx.Exec(ctx,
				`UPDATE accounts SET balance = balance + $1 WHERE id = $2 AND user_id = $3`,
				old.Amount, old.AccountID, userID,
			)
			if err == nil {
				_, err = dbTx.Exec(ctx,
					`UPDATE accounts SET balance = balance - $1 WHERE id = $2 AND user_id = $3`,
					old.Amount, *old.ToAccountID, userID,
				)
			}
		}
	case models.TransactionTypeAdjustment:
		// ไม่มี balance ที่ต้อง reverse
	}
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to reverse old balance"})
		return
	}

	// 4. Update transaction row
	var t models.Transaction
	err = dbTx.QueryRow(ctx,
		`UPDATE transactions
		 SET category_id      = COALESCE($1, category_id),
		     amount           = COALESCE($2, amount),
		     name             = COALESCE($3, name),
		     note             = COALESCE($4, note),
		     transaction_date = COALESCE($5, transaction_date)
		 WHERE id = $6 AND user_id = $7
		 RETURNING id, user_id, account_id, to_account_id, category_id, type, amount, name, note, transaction_date, is_recurring, created_at, updated_at`,
		req.CategoryID, req.Amount, req.Name, req.Note, txDate, id, userID,
	).Scan(&t.ID, &t.UserID, &t.AccountID, &t.ToAccountID, &t.CategoryID,
		&t.Type, &t.Amount, &t.Name, &t.Note, &t.TransactionDate, &t.IsRecurring, &t.CreatedAt, &t.UpdatedAt)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to update transaction"})
		return
	}

	// 5. Apply balance ใหม่ (เหมือน create แต่ใช้ค่าจาก t ที่ updated แล้ว)
	switch t.Type {
	case models.TransactionTypeIncome:
		_, err = dbTx.Exec(ctx,
			`UPDATE accounts SET balance = balance + $1 WHERE id = $2 AND user_id = $3`,
			t.Amount, t.AccountID, userID,
		)
	case models.TransactionTypeExpense:
		_, err = dbTx.Exec(ctx,
			`UPDATE accounts SET balance = balance - $1 WHERE id = $2 AND user_id = $3`,
			t.Amount, t.AccountID, userID,
		)
	case models.TransactionTypeTransfer:
		if t.ToAccountID != nil {
			_, err = dbTx.Exec(ctx,
				`UPDATE accounts SET balance = balance - $1 WHERE id = $2 AND user_id = $3`,
				t.Amount, t.AccountID, userID,
			)
			if err == nil {
				_, err = dbTx.Exec(ctx,
					`UPDATE accounts SET balance = balance + $1 WHERE id = $2 AND user_id = $3`,
					t.Amount, *t.ToAccountID, userID,
				)
			}
		}
	case models.TransactionTypeAdjustment:
		// ปรับยอด: ไม่เปลี่ยน balance
	}
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to apply new balance"})
		return
	}

	// 6. Commit
	if err := dbTx.Commit(ctx); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to commit transaction"})
		return
	}

	c.JSON(http.StatusOK, t)
}

// DELETE /api/v1/transactions/:id
// ลบ transaction พร้อม reverse balance กลับ
func (h *TransactionHandler) Delete(c *gin.Context) {
	userID := c.GetString("user_id")
	id := c.Param("id")

	ctx := context.Background()

	// ดึงข้อมูล transaction ก่อน เพื่อจะได้ reverse balance ถูก
	var t models.Transaction
	err := h.db.QueryRow(ctx,
		`SELECT id, user_id, account_id, to_account_id, type, amount FROM transactions WHERE id = $1 AND user_id = $2`,
		id, userID,
	).Scan(&t.ID, &t.UserID, &t.AccountID, &t.ToAccountID, &t.Type, &t.Amount)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "transaction not found"})
		return
	}

	// เริ่ม DB transaction
	dbTx, err := h.db.Begin(ctx)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to begin transaction"})
		return
	}
	defer dbTx.Rollback(ctx)

	// ลบ transaction
	result, err := dbTx.Exec(ctx, `DELETE FROM transactions WHERE id = $1 AND user_id = $2`, id, userID)
	if err != nil || result.RowsAffected() == 0 {
		c.JSON(http.StatusNotFound, gin.H{"error": "transaction not found"})
		return
	}

	// Reverse balance
	switch t.Type {
	case models.TransactionTypeIncome:
		// คืน balance (เคยบวก ก็ลบคืน)
		_, err = dbTx.Exec(ctx,
			`UPDATE accounts SET balance = balance - $1 WHERE id = $2 AND user_id = $3`,
			t.Amount, t.AccountID, userID,
		)
	case models.TransactionTypeExpense:
		// คืน balance (เคยลบ ก็บวกคืน)
		_, err = dbTx.Exec(ctx,
			`UPDATE accounts SET balance = balance + $1 WHERE id = $2 AND user_id = $3`,
			t.Amount, t.AccountID, userID,
		)
	case models.TransactionTypeTransfer:
		if t.ToAccountID != nil {
			// คืน balance ต้นทาง (เคยลบ ก็บวกคืน)
			_, err = dbTx.Exec(ctx,
				`UPDATE accounts SET balance = balance + $1 WHERE id = $2 AND user_id = $3`,
				t.Amount, t.AccountID, userID,
			)
			if err == nil {
				_, err = dbTx.Exec(ctx,
					`UPDATE accounts SET balance = balance - $1 WHERE id = $2 AND user_id = $3`,
					t.Amount, *t.ToAccountID, userID,
				)
			}
		}
	case models.TransactionTypeAdjustment:
		// ปรับยอด: ไม่มี balance ที่ต้อง reverse
	}

	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to reverse account balance"})
		return
	}

	if err := dbTx.Commit(ctx); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to commit"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"message": "transaction deleted"})
}
