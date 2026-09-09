package dbq

import (
	"strings"
	"testing"

	"gorm.io/driver/postgres"
	"gorm.io/gorm"
)

func TestLikePatternEscapesWildcards(t *testing.T) {
	// A term the user typed is data, not pattern: each of these three would
	// otherwise silently widen the search.
	for term, want := range map[string]string{
		"nake":   "%nake%",
		"50%":    `%50\%%`,
		"a_b":    `%a\_b%`,
		`c:\tmp`: `%c:\\tmp%`,
	} {
		if got := LikePattern(term); got != want {
			t.Errorf("LikePattern(%q) = %q, want %q", term, got, want)
		}
	}
}

// dryRunDB builds SQL without a server, so this stays a unit test.
func dryRunDB(t *testing.T) *gorm.DB {
	t.Helper()
	db, err := gorm.Open(postgres.New(postgres.Config{DSN: "postgres://x/y"}), &gorm.Config{
		DryRun:               true,
		DisableAutomaticPing: true,
	})
	if err != nil {
		t.Fatalf("open dry-run database: %v", err)
	}
	return db
}

type row struct {
	ID   int
	Name string
	Code string
}

func TestSearchGroupsItsOrAndKeepsTheTermBound(t *testing.T) {
	db := dryRunDB(t)
	stmt := Search(db.Model(&row{}).Where("id = ?", 1), "ab", "name", "code").Find(&[]row{}).Statement
	sql := stmt.SQL.String()

	// Unparenthesised, `id = 1 AND name ILIKE ... OR code ILIKE ...` matches
	// every row whose code hits — the filter beside it stops applying.
	if !strings.Contains(sql, "(name ILIKE $2 OR code ILIKE $3)") {
		t.Errorf("OR is not grouped: %s", sql)
	}
	if strings.Contains(sql, "ab") {
		t.Errorf("search term was interpolated, not bound: %s", sql)
	}
}

func TestSearchWithoutATermIsANoOp(t *testing.T) {
	db := dryRunDB(t)
	stmt := Search(db.Model(&row{}), "", "name").Find(&[]row{}).Statement
	if strings.Contains(stmt.SQL.String(), "ILIKE") {
		t.Errorf("empty term still filtered: %s", stmt.SQL.String())
	}
}

// The whitelist is the security boundary: ?sort= comes off the request, and
// ORDER BY takes no bound parameter. The rest is the two rules every list gets
// for free — a tiebreaker, and empty values last.
func TestSortOrderBy(t *testing.T) {
	sorter := Sort{
		Columns:  map[string]string{"name": "name", "seen_at": "seen_at"},
		Default:  "created_at desc",
		Tiebreak: "id",
	}
	for _, tc := range []struct {
		sort string
		desc bool
		want string
	}{
		{"name", false, "name asc NULLS LAST, id"},
		{"seen_at", true, "seen_at desc NULLS LAST, id"},
		// Nobody asked for an order.
		{"", false, "created_at desc, id"},
		// A name that is not on the list is the default order, not SQL.
		{"name; DROP TABLE things --", true, "created_at desc, id"},
	} {
		if got := sorter.OrderBy(tc.sort, tc.desc); got != tc.want {
			t.Errorf("OrderBy(%q, %v) = %q, want %q", tc.sort, tc.desc, got, tc.want)
		}
	}

	// A table keyed by something unique on its own needs no tiebreaker, and
	// must not be given one it has no column for.
	byCode := Sort{Columns: map[string]string{"name": "name"}, Tiebreak: "code"}
	if got := byCode.OrderBy("", false); got != "code" {
		t.Errorf("no default and no sort should be the tiebreaker alone, got %q", got)
	}
}
