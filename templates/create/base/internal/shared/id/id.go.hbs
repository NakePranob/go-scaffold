// Package id creates entity identifiers — "the whole system uses UUID v7" is
// decided in one place, so changing the scheme is a one-file change.
package id

import "github.com/google/uuid"

// New returns a UUID v7 (time-ordered, so rows sort by creation time and the
// B-tree takes fewer page splits than v4 random IDs under heavy writes).
// Falls back to v4 if entropy fails (practically impossible — reads
// crypto/rand), so the entity-creation path never has to handle the error.
func New() uuid.UUID {
	if v7, err := uuid.NewV7(); err == nil {
		return v7
	}
	return uuid.New()
}
