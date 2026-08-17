// Package tx carries a database transaction on the request context, so that
// several repositories can take part in one atomic write without every
// method growing a *gorm.DB parameter (which would leak GORM into the
// service layer and break every existing signature).
//
// Repositories call From; callers that need more than one write to succeed
// or fail together call Do. Code that does neither behaves exactly as it did
// before this package existed.
package tx

import (
	"context"

	"gorm.io/gorm"
)

// ctxKey is unexported so no other package can put a *gorm.DB in this slot.
type ctxKey struct{}

// Do runs fn inside one transaction: every repository called from fn picks
// it up via From, so returning an error from anywhere rolls back everything.
//
// A nested Do reuses the outer transaction instead of opening a savepoint —
// a partial rollback is almost never what the caller means, and one commit
// boundary per request is far easier to reason about.
//
// Never hand the ctx passed to fn to a goroutine, a queue, or anything that
// outlives Do: the transaction is closed on return, and later use of it
// fails with "transaction has already been committed or rolled back".
func Do(ctx context.Context, db *gorm.DB, fn func(context.Context) error) error {
	if _, ok := ctx.Value(ctxKey{}).(*gorm.DB); ok {
		return fn(ctx)
	}
	return db.WithContext(ctx).Transaction(func(t *gorm.DB) error {
		return fn(context.WithValue(ctx, ctxKey{}, t))
	})
}

// From returns the transaction running on ctx, or db when there is none, so
// a repository method behaves identically whether or not its caller opened
// a transaction.
func From(ctx context.Context, db *gorm.DB) *gorm.DB {
	if t, ok := ctx.Value(ctxKey{}).(*gorm.DB); ok {
		return t
	}
	return db
}
