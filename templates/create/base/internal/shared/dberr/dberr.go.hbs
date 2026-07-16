// Package dberr translates driver/GORM errors into "which constraint kind
// broke" — glue with no I/O, so it lives in shared/, not platform/.
// Centralized so every domain maps DB errors to HTTP status the same way,
// instead of copy-pasting the logic per module.
package dberr

import (
	"errors"
	"strings"

	"gorm.io/gorm"
)

// IsDuplicate reports a unique constraint violation — gorm.ErrDuplicatedKey
// (requires TranslateError:true), with a string fallback in case the driver
// doesn't translate: postgres "duplicate key value violates unique constraint".
func IsDuplicate(err error) bool {
	return errors.Is(err, gorm.ErrDuplicatedKey) ||
		strings.Contains(strings.ToLower(err.Error()), "unique constraint")
}

// IsForeignKey reports a foreign key violation (referencing a missing parent,
// or deleting a parent that's still referenced).
// gorm.ErrForeignKeyViolated + string fallback: postgres "...foreign key constraint...".
func IsForeignKey(err error) bool {
	return errors.Is(err, gorm.ErrForeignKeyViolated) ||
		strings.Contains(strings.ToLower(err.Error()), "foreign key")
}
