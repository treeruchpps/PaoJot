package budget

import "time"

// ฟังก์ชันคำนวณช่วงเวลาของงบประมาณ (pure logic ไม่ยุ่งกับ DB/HTTP)

func parseDate(value string) (time.Time, error) {
	return time.Parse("2006-01-02", value)
}

func dateString(t time.Time) string {
	return t.Format("2006-01-02")
}

func dateOnly(t time.Time) time.Time {
	return time.Date(t.Year(), t.Month(), t.Day(), 0, 0, 0, 0, time.Local)
}

func currentWeekRange(today time.Time, weekStartDay int) (time.Time, time.Time) {
	today = dateOnly(today)
	diff := int(today.Weekday()) - weekStartDay
	if diff < 0 {
		diff += 7
	}
	start := today.AddDate(0, 0, -diff)
	return start, start.AddDate(0, 0, 6)
}

func calendarWindow(budgetType string, today time.Time, weekStartDay int) (time.Time, time.Time) {
	today = dateOnly(today)
	switch budgetType {
	case "week":
		return currentWeekRange(today, weekStartDay)
	case "month":
		start := time.Date(today.Year(), today.Month(), 1, 0, 0, 0, 0, time.Local)
		return start, start.AddDate(0, 1, -1)
	case "year":
		start := time.Date(today.Year(), 1, 1, 0, 0, 0, 0, time.Local)
		return start, time.Date(today.Year(), 12, 31, 0, 0, 0, 0, time.Local)
	default:
		return time.Time{}, time.Time{}
	}
}

func normalizeRange(budgetType string, referenceDate time.Time, weekStartDay int) (time.Time, time.Time, bool) {
	start, end := calendarWindow(budgetType, referenceDate, weekStartDay)
	if start.IsZero() {
		return time.Time{}, time.Time{}, false
	}
	return start, end, true
}

func nextWindow(start, end time.Time, today time.Time, budgetType string, weekStartDay int) (time.Time, time.Time) {
	if nextStart, nextEnd := calendarWindow(budgetType, today, weekStartDay); !nextStart.IsZero() {
		return nextStart, nextEnd
	}

	durationDays := int(end.Sub(start).Hours()/24) + 1
	if durationDays < 1 {
		durationDays = 1
	}
	for end.Before(today) {
		start = end.AddDate(0, 0, 1)
		end = start.AddDate(0, 0, durationDays-1)
	}
	return start, end
}
