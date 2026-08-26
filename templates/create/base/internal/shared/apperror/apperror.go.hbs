package apperror

import "net/http"

// AppError is an error that knows both its HTTP status and its payload.
// Lower layers (service/repo) can return one without importing net/http themselves.
type AppError struct {
	HTTPStatus int    `json:"-"`
	Code       string `json:"code"`
	Message    string `json:"message"`
	Details    any    `json:"details,omitempty"`
	RequestID  string `json:"request_id,omitempty"` // filled in by the error middleware
	cause      error
}

func (e *AppError) Error() string { return e.Message }

// Unwrap keeps the technical cause available to structured logging and
// errors.Is/As without putting it in the JSON response.
func (e *AppError) Unwrap() error { return e.cause }

func New(status int, code, msg string) *AppError {
	return &AppError{HTTPStatus: status, Code: code, Message: msg}
}

func NewValidation(msg string, details any) *AppError {
	return &AppError{HTTPStatus: http.StatusBadRequest, Code: "VALIDATION_ERROR", Message: msg, Details: details}
}

func NewNotFound(msg string) *AppError {
	return &AppError{HTTPStatus: http.StatusNotFound, Code: "NOT_FOUND", Message: msg}
}

func NewConflict(msg string) *AppError {
	return &AppError{HTTPStatus: http.StatusConflict, Code: "CONFLICT", Message: msg}
}

func NewInternal(cause ...error) *AppError {
	// ponytail: never leak internal details to the client, log separately in middleware
	err := &AppError{HTTPStatus: http.StatusInternalServerError, Code: "INTERNAL", Message: "internal server error"}
	if len(cause) > 0 {
		err.cause = cause[0]
	}
	return err
}

func NewNotImplemented() *AppError {
	return &AppError{HTTPStatus: http.StatusNotImplemented, Code: "NOT_IMPLEMENTED", Message: "not implemented"}
}
