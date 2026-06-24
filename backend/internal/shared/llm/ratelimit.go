package llm

import (
	"context"
	"sync"
	"time"
)

type requestLimiter struct {
	mu       sync.Mutex
	next     time.Time
	interval time.Duration
}

func newRequestLimiter(interval time.Duration) *requestLimiter {
	return &requestLimiter{interval: interval}
}

func (l *requestLimiter) Wait(ctx context.Context) error {
	l.mu.Lock()
	now := time.Now()
	wait := time.Duration(0)
	if l.next.After(now) {
		wait = l.next.Sub(now)
	}
	slotBase := now
	if l.next.After(now) {
		slotBase = l.next
	}
	l.next = slotBase.Add(l.interval)
	l.mu.Unlock()

	if wait <= 0 {
		return nil
	}
	timer := time.NewTimer(wait)
	defer timer.Stop()
	select {
	case <-ctx.Done():
		return ctx.Err()
	case <-timer.C:
		return nil
	}
}

var (
	// Typhoon OCR limit is stricter than the LLM endpoint: 20 RPM means one OCR call
	// every ~3 seconds. Keep a small buffer to reduce 429 responses from bursty jobs.
	typhoonOCRLimiter = newRequestLimiter(3200 * time.Millisecond)
	typhoonLLMLimiter = newRequestLimiter(700 * time.Millisecond)
)

// WaitTyphoonOCR รอ slot สำหรับเรียก Typhoon OCR (global rate limit)
func WaitTyphoonOCR(ctx context.Context) error {
	return typhoonOCRLimiter.Wait(ctx)
}

// WaitTyphoonLLM รอ slot สำหรับเรียก Typhoon LLM (global rate limit)
func WaitTyphoonLLM(ctx context.Context) error {
	return typhoonLLMLimiter.Wait(ctx)
}
