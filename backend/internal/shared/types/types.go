// Package types เก็บ type/enum ที่ใช้ร่วมกันข้าม feature
// เพื่อเลี่ยงการ import วนกันระหว่าง feature package
package types

// TransactionType คือชนิดของธุรกรรม ใช้ร่วมกันใน transaction, category, notification
type TransactionType string

const (
	TransactionTypeIncome         TransactionType = "income"
	TransactionTypeExpense        TransactionType = "expense"
	TransactionTypeTransfer       TransactionType = "transfer"
	TransactionTypeAdjustment     TransactionType = "adjustment"
	TransactionTypeGoalDeposit    TransactionType = "goal_deposit"
	TransactionTypeGoalWithdrawal TransactionType = "goal_withdrawal"
)
