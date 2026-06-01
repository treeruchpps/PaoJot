package handlers

import (
	"context"
	"sync"
	"time"
)

type typhoonRequestLimiter struct {
	mu       sync.Mutex
	next     time.Time
	interval time.Duration
}

func newTyphoonRequestLimiter(interval time.Duration) *typhoonRequestLimiter {
	return &typhoonRequestLimiter{interval: interval}
}

func (l *typhoonRequestLimiter) Wait(ctx context.Context) error {
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
	typhoonOCRLimiter = newTyphoonRequestLimiter(3200 * time.Millisecond)
	typhoonLLMLimiter = newTyphoonRequestLimiter(700 * time.Millisecond)
)

func waitTyphoonOCR(ctx context.Context) error {
	return typhoonOCRLimiter.Wait(ctx)
}

func waitTyphoonLLM(ctx context.Context) error {
	return typhoonLLMLimiter.Wait(ctx)
}
