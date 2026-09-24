package pagination

import (
	"strconv"
	"strings"

	"github.com/gin-gonic/gin"
)

const (
	defaultLimit = 20
	maxLimit     = 100
	// Long enough for any name or address anyone types into a search box, and
	// short enough that the LIKE it becomes cannot be used to make the
	// database do real work.
	maxSearchRunes = 100
)

// Params is a validated limit/offset pair (default 20, capped at 100) plus the
// free-text search the list was asked for.
type Params struct {
	Limit  int
	Offset int
	// Search is ?q= trimmed, empty when the caller sent none — so a repository
	// can pass it straight to dbq.Search, which no-ops on an empty term.
	Search string
	// Sort is ?sort=, the column the client asked to be ordered by, and Desc
	// is ?order=desc. Nothing is validated here on purpose: which names an
	// endpoint accepts is its repository's to say, and dbq.Sort is where that
	// whitelist is applied — a name it does not know falls back to the list's
	// own order rather than failing the request.
	Sort string
	Desc bool
}

// Parse reads ?limit=&offset=&q=&sort=&order= off the request so every feature
// parses the same way.
func Parse(c *gin.Context) Params {
	p := Params{Limit: defaultLimit}
	if v, err := strconv.Atoi(c.Query("limit")); err == nil && v > 0 {
		p.Limit = v
	}
	if p.Limit > maxLimit {
		p.Limit = maxLimit
	}
	if v, err := strconv.Atoi(c.Query("offset")); err == nil && v >= 0 {
		p.Offset = v
	}
	// Runes, not bytes: one non-Latin character is often three bytes, and
	// cutting one in half would send invalid UTF-8 into the query.
	if q := strings.TrimSpace(c.Query("q")); q != "" {
		if r := []rune(q); len(r) > maxSearchRunes {
			q = string(r[:maxSearchRunes])
		}
		p.Search = q
	}
	p.Sort = strings.TrimSpace(c.Query("sort"))
	// Ascending unless asked otherwise: one spelling of "the other way", and
	// anything else read as the default rather than refused.
	p.Desc = c.Query("order") == "desc"
	return p
}

// Response wraps a list so every feature responds with the same shape.
func (p Params) Response(data any) gin.H {
	return gin.H{"data": data, "limit": p.Limit, "offset": p.Offset}
}

// ResponseWithTotal is Response plus the row count the filter matched, which
// is what a client needs to render "page 3 of 12". Separate rather than
// folded into Response because the count costs a second query:
//
//	var total int64
//	if err := db.Model(&model.Thing{}).Count(&total).Error; err != nil { ... }
//	c.JSON(http.StatusOK, p.ResponseWithTotal(out, total))
func (p Params) ResponseWithTotal(data any, total int64) gin.H {
	return gin.H{"data": data, "limit": p.Limit, "offset": p.Offset, "total": total}
}
