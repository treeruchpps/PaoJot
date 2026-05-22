package router

import (
	"paomoney/internal/config"
	"paomoney/internal/handlers"
	"paomoney/internal/middleware"

	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5/pgxpool"
)

func Setup(db *pgxpool.Pool, cfg *config.Config) *gin.Engine {
	r := gin.Default()

	// CORS
	r.Use(func(c *gin.Context) {
		c.Header("Access-Control-Allow-Origin", "*")
		c.Header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
		c.Header("Access-Control-Allow-Headers", "Authorization, Content-Type")
		if c.Request.Method == "OPTIONS" {
			c.AbortWithStatus(204)
			return
		}
		c.Next()
	})

	// Handlers
	authH := handlers.NewAuthHandler(db, cfg)
	googleAuthH := handlers.NewGoogleAuthHandler(db, cfg)
	profileH := handlers.NewProfileHandler(db)
	accountH := handlers.NewAccountHandler(db)
	categoryH := handlers.NewCategoryHandler(db)
	txH := handlers.NewTransactionHandler(db)
	goalH := handlers.NewSavingsGoalHandler(db)
	budgetH := handlers.NewBudgetHandler(db)
	recurH := handlers.NewRecurringHandler(db)
	notiH := handlers.NewNotificationHandler(db)
	slipH := handlers.NewSlipHandler(db, cfg)
	receiptH := handlers.NewReceiptHandler(db, cfg)
	aiSummaryH := handlers.NewAISummaryHandler(db, cfg)

	// Static file serving for uploaded slip images
	r.Static("/uploads", "./uploads")

	v1 := r.Group("/api/v1")

	// Auth (public)
	auth := v1.Group("/auth")
	{
		auth.POST("/register", authH.Register)
		auth.POST("/login", authH.Login)
		auth.POST("/refresh", authH.Refresh)
		auth.GET("/google", googleAuthH.Redirect)
		auth.GET("/google/callback", googleAuthH.Callback)
	}

	// Protected routes
	protected := v1.Group("")
	protected.Use(middleware.AuthRequired(cfg.JWT.Secret))
	{
		// Profile
		protected.GET("/profile", profileH.GetProfile)
		protected.PUT("/profile", profileH.UpdateProfile)
		protected.PUT("/auth/change-password", authH.ChangePassword)

		// Accounts
		protected.GET("/accounts", accountH.List)
		protected.POST("/accounts", accountH.Create)
		protected.GET("/accounts/:id", accountH.Get)
		protected.PUT("/accounts/:id", accountH.Update)
		protected.DELETE("/accounts/:id", accountH.Delete)

		// Categories
		protected.GET("/categories", categoryH.List)
		protected.POST("/categories", categoryH.Create)
		protected.PUT("/categories/:id", categoryH.Update)
		protected.DELETE("/categories/:id", categoryH.Delete)

		// Transactions
		protected.GET("/transactions", txH.List)
		protected.POST("/transactions", txH.Create)
		protected.GET("/transactions/:id", txH.Get)
		protected.PUT("/transactions/:id", txH.Update)
		protected.DELETE("/transactions/:id", txH.Delete)

		// Savings Goals
		protected.GET("/savings-goals", goalH.List)
		protected.POST("/savings-goals", goalH.Create)
		protected.POST("/savings-goals/images", goalH.UploadImage)
		protected.GET("/savings-goals/:id", goalH.Get)
		protected.PUT("/savings-goals/:id", goalH.Update)
		protected.DELETE("/savings-goals/:id", goalH.Delete)
		protected.POST("/savings-goals/:id/deposit", goalH.Deposit)

		// Budgets
		protected.GET("/budgets", budgetH.List)
		protected.POST("/budgets", budgetH.Create)
		protected.GET("/budgets/:id", budgetH.Get)
		protected.PUT("/budgets/:id", budgetH.Update)
		protected.DELETE("/budgets/:id", budgetH.Delete)

		// Recurring Transactions
		protected.GET("/recurring", recurH.List)
		protected.POST("/recurring", recurH.Create)
		protected.PUT("/recurring/:id", recurH.Update)
		protected.DELETE("/recurring/:id", recurH.Delete)

		// Notifications
		protected.GET("/notifications", notiH.List)
		protected.POST("/notifications/:id/confirm", notiH.Confirm)
		protected.POST("/notifications/:id/skip", notiH.Skip)
		protected.PUT("/notifications/read-all", notiH.ReadAll)

		// AI financial summary
		protected.GET("/ai-summary", aiSummaryH.Get)
		protected.POST("/ai-summary", aiSummaryH.Generate)

		// Receipt scanning (async, batch job)
		protected.GET("/receipt-jobs", receiptH.ListJobs)
		protected.POST("/receipt-jobs", receiptH.CreateJob)
		protected.GET("/receipt-jobs/:id", receiptH.GetJob)
		protected.POST("/receipt-jobs/:id/cancel", receiptH.CancelJob)
		protected.POST("/receipt-jobs/:id/results/:result_id/save", receiptH.MarkResultSaved)
		protected.POST("/receipt-jobs/:id/results/:result_id/skip", receiptH.SkipResult)

		// Slip scanning (batch job)
		protected.GET("/slip-jobs", slipH.ListJobs)
		protected.POST("/slip-jobs", slipH.CreateJob)
		protected.GET("/slip-jobs/:id", slipH.GetJob)
		protected.POST("/slip-jobs/:id/cancel", slipH.CancelJob)
		protected.POST("/slip-jobs/:id/results/:result_id/save", slipH.SaveResult)
		protected.POST("/slip-jobs/:id/results/:result_id/skip", slipH.SkipResult)
	}

	return r
}
