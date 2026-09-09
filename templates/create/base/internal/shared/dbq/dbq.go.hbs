// Package dbq holds the SQL every list endpoint repeats, so a filter is not
// re-derived — and re-broken — once per module.
package dbq

import (
	"strings"

	"gorm.io/gorm"
)

// likeEscaper protects the pattern's own metacharacters. Backslash first, or
// it would escape the backslashes the other two just added.
var likeEscaper = strings.NewReplacer(`\`, `\\`, `%`, `\%`, `_`, `\_`)

// LikePattern turns a search term into a `contains` pattern with the wildcards
// escaped, so searching for "50%" looks for the three characters "50%" rather
// than for anything starting with 50.
//
// Postgres already treats backslash as LIKE's escape character, so the pattern
// needs no trailing ESCAPE clause.
func LikePattern(term string) string {
	return "%" + likeEscaper.Replace(term) + "%"
}

// Search narrows db to rows where any of cols contains term, ignoring case.
// An empty term returns db untouched, so a caller applies it unconditionally:
//
//	q = dbq.Search(q, filter.Search, "name", "code")
//
// cols are SQL identifiers written by the caller. Never pass one that came off
// the request — they are interpolated; only the term is a bound parameter.
func Search(db *gorm.DB, term string, cols ...string) *gorm.DB {
	if term == "" || len(cols) == 0 {
		return db
	}
	pattern := LikePattern(term)
	conds := make([]string, len(cols))
	args := make([]any, len(cols))
	for i, col := range cols {
		conds[i] = col + " ILIKE ?"
		args[i] = pattern
	}
	// Parenthesised here rather than trusting the driver to group it: ANDed
	// with a second filter, an unwrapped OR would widen the result instead of
	// narrowing it.
	return db.Where("("+strings.Join(conds, " OR ")+")", args...)
}

// Sort is a list endpoint's ordering contract: the columns it accepts, the
// order it has before anyone asks for one, and the column that breaks ties.
// Declare it once per repository, beside the FindAll that uses it.
type Sort struct {
	// Columns maps the names the API accepts to the SQL each one means, and is
	// the whole of what can reach the clause: ORDER BY takes no bound
	// parameter, so a ?sort= that is not a key here is never interpolated. A
	// value the table does not hold — an address one table over — is a
	// subquery rather than a join, which would need its own SELECT list to
	// keep Find scanning the right row.
	Columns map[string]string
	// Default is the order for a request that asked for nothing Columns knows,
	// written without the tiebreaker: OrderBy adds it.
	Default string
	// Tiebreak is a column unique enough to page by, usually the primary key.
	// Without it two rows equal on the sorted column can swap places between
	// page 1 and page 2, showing one twice and hiding the other. Leave it empty
	// only when Columns and Default are unique on their own.
	Tiebreak string
}

// OrderBy resolves what the request asked for into an ORDER BY clause:
//
//	q = q.Order(thingSort.OrderBy(filter.Sort, filter.Desc))
//
// Sorted columns get NULLS LAST in both directions, because a row with no
// value is missing an answer rather than holding the largest one — the account
// that has never signed in belongs at the bottom whichever way the column is
// pointed. It is a no-op on a column that cannot be null.
func (s Sort) OrderBy(sort string, desc bool) string {
	clause := s.Default
	if col, ok := s.Columns[sort]; ok {
		dir := "asc"
		if desc {
			dir = "desc"
		}
		clause = col + " " + dir + " NULLS LAST"
	}
	switch {
	case s.Tiebreak == "":
		return clause
	case clause == "":
		return s.Tiebreak
	default:
		return clause + ", " + s.Tiebreak
	}
}
