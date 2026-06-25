package router

import (
	"paomoney/internal/account"
	"paomoney/internal/aisummary"
	"paomoney/internal/auth"
	"paomoney/internal/budget"
	"paomoney/internal/category"
	"paomoney/internal/config"
	"paomoney/internal/middleware"
	"paomoney/internal/notification"
	"paomoney/internal/profile"
	"paomoney/internal/quickentry"
	"paomoney/internal/recurring"
	"paomoney/internal/savingsgoal"
	"paomoney/internal/scan"
	"paomoney/internal/shared/storage"
	"paomoney/internal/transaction"

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

	// Shared file storage (R2 or local fallback)
	store := storage.New(cfg)

	// Handlers
	authH := auth.NewHandler(db, cfg)
	profileH := profile.NewHandler(db)
	accountH := account.NewHandler(db)
	categoryH := category.NewHandler(db)
	txH := transaction.NewHandler(db)
	goalH := savingsgoal.NewHandler(db, store)
	budgetH := budget.NewHandler(db)
	recurH := recurring.NewHandler(db)
	notiH := notification.NewHandler(db)
	scanH := scan.NewScanHandler(db, cfg, store)
	aiSummaryH := aisummary.NewAISummaryHandler(db, cfg)
	quickEntryH := quickentry.NewQuickEntryHandler(db, cfg)

	// Static file serving for uploaded slip images
	r.Static("/uploads", "./uploads")

	v1 := r.Group("/api/v1")

	// Auth (public)
	authGroup := v1.Group("/auth")
	{
		authGroup.POST("/register", authH.Register)
		authGroup.POST("/login", authH.Login)
		authGroup.POST("/refresh", authH.Refresh)
		authGroup.GET("/google", authH.Redirect)
		authGroup.GET("/google/callback", authH.Callback)
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
		protected.POST("/savings-goals/:id/initial-balance", goalH.AddInitialBalance)
		protected.POST("/savings-goals/:id/deposit", goalH.Deposit)
		protected.POST("/savings-goals/:id/withdraw", goalH.Withdraw)

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
		protected.GET("/ai-summary/eligibility", aiSummaryH.Eligibility)
		protected.POST("/ai-summary", aiSummaryH.Generate)

		// Quick entry assistant
		protected.GET("/quick-entry/chat-log", quickEntryH.GetChatLog)
		protected.PUT("/quick-entry/chat-log", quickEntryH.SaveChatLog)
		protected.DELETE("/quick-entry/chat-log", quickEntryH.ClearChatLog)
		protected.POST("/quick-entry/parse", quickEntryH.Parse)

		// Unified document scanning (receipt/slip auto classification)
		protected.GET("/scan-jobs", scanH.ListJobs)
		protected.POST("/scan-jobs", scanH.CreateJob)
		protected.GET("/scan-jobs/:id", scanH.GetJob)
		protected.POST("/scan-jobs/:id/cancel", scanH.CancelJob)
		protected.POST("/scan-jobs/:id/results/:result_id/save", scanH.MarkResultSaved)
		protected.POST("/scan-jobs/:id/results/:result_id/save-slip", scanH.SaveSlipResult)
		protected.POST("/scan-jobs/:id/results/:result_id/skip", scanH.SkipResult)

	}

	return r
}
