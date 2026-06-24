package savingsgoal

import (
	"errors"
	"net/http"

	"paomoney/internal/shared/ledger"
)

// httpError พก HTTP status + ข้อความ เพื่อรักษาพฤติกรรม error เดิมครบทุกเคส
type httpError struct {
	status int
	msg    string
}

func (e *httpError) Error() string { return e.msg }
func (e *httpError) Status() int   { return e.status }

func badRequest(msg string) *httpError { return &httpError{http.StatusBadRequest, msg} }
func notFound(msg string) *httpError   { return &httpError{http.StatusNotFound, msg} }
func internal(msg string) *httpError   { return &httpError{http.StatusInternalServerError, msg} }

// balanceError แปลง error จาก ledger เป็น httpError (400 ถ้าเงินไม่พอ/ไม่พบบัญชี ไม่งั้น 500)
func balanceError(err error) *httpError {
	status := http.StatusInternalServerError
	if errors.Is(err, ledger.ErrInsufficientFunds) || errors.Is(err, ledger.ErrAccountNotFound) {
		status = http.StatusBadRequest
	}
	return &httpError{status, ledger.ErrorMessage(err)}
}
