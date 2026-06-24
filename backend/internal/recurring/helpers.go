package recurring

import (
	"fmt"
	"time"
)

// AdvanceNextDue คำนวณ next_due_date ถัดไปจาก frequency
func AdvanceNextDue(current time.Time, frequency string) time.Time {
	switch frequency {
	case "daily":
		return current.AddDate(0, 0, 1)
	case "weekly":
		return current.AddDate(0, 0, 7)
	case "yearly":
		return current.AddDate(1, 0, 0)
	default: // monthly
		return current.AddDate(0, 1, 0)
	}
}

// FrequencyLabel แปลง enum เป็นภาษาไทย
func FrequencyLabel(f string) string {
	switch f {
	case "daily":
		return "ทุกวัน"
	case "weekly":
		return "ทุกสัปดาห์"
	case "yearly":
		return "ทุกปี"
	default:
		return "ทุกเดือน"
	}
}

// BuildNotificationTitle สร้าง title สำหรับ notification ของรายการประจำที่ครบกำหนด
func BuildNotificationTitle(r RecurringTransaction) string {
	name := "รายการประจำ"
	if r.Name != nil && *r.Name != "" {
		name = *r.Name
	}
	return fmt.Sprintf("%s ครบกำหนดวันนี้ (฿%.0f)", name, r.Amount)
}
