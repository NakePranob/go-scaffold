// Package migrations embeds the migration SQL files so the running binary
// can check its own schema version without shelling out to the migrate CLI.
package migrations

import "embed"

// ponytail: pattern is "*", not "*.sql" — a fresh project has zero .sql files
// until the first `generate module`, and "*.sql" fails to compile ("no
// matching files") until one exists. "*" always matches at least .gitkeep, so
// this builds from `create` onward; the harmless cost is embedding .gitkeep
// and this file itself alongside real migrations, which CheckMigrationVersion
// already skips over (regex requires a numeric prefix and .up.sql suffix).
//
//go:embed *
var FS embed.FS
