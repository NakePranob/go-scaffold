package middleware

import (
	"crypto/rand"
	"encoding/hex"

	"github.com/gin-gonic/gin"
)

const (
	RequestIDKey    = "request_id"
	requestIDHeader = "X-Request-ID"
)

// RequestID reads X-Request-ID from the client, generating one if absent,
// stores it in context, and echoes it back in the response header — used to
// correlate logs/errors across services.
func RequestID() gin.HandlerFunc {
	return func(c *gin.Context) {
		id := c.GetHeader(requestIDHeader)
		if id == "" {
			id = newID()
		}
		c.Set(RequestIDKey, id)
		c.Header(requestIDHeader, id)
		c.Next()
	}
}

func newID() string {
	b := make([]byte, 8)
	if _, err := rand.Read(b); err != nil {
		return "unknown"
	}
	return hex.EncodeToString(b)
}
