# @nakedev/go-scaffold

A CLI that scaffolds a Gin + GORM + PostgreSQL Go backend, then keeps
generating consistent domain modules into that project as it grows — the Go
counterpart to [nest-scaffold](../nest-scaffold).

You don't hand-wire a new domain into `cmd/api/main.go`, write the
handler/service/repository boilerplate, or decide error-handling conventions
each time — the CLI does that, and every module it generates follows the
same shape as the last one.

## Install

```bash
pnpm install
pnpm run build
```

`npm link` / `pnpm link --global` may not put the binary on your `PATH`
depending on your machine's npm/pnpm global-bin config — rather than fight
that, run the CLI directly, or add a shell alias once:

```bash
node bin/go-scaffold.js create my-api --defaults
# or: alias go-scaffold="node $(pwd)/bin/go-scaffold.js"
```

The rest of this README uses the bare `go-scaffold ...` form for brevity —
substitute the `node bin/go-scaffold.js ...` form or your alias if you
haven't linked it.

## Quick start

```bash
go-scaffold create my-api
cd my-api
make docker-up   # if you kept Docker + PostgreSQL
go mod tidy
make run
```

Then grow the project without leaving the CLI:

```bash
go-scaffold generate module orders
go-scaffold generate method orders approve --type patch
```

## Commands

### `create <name>` — scaffold a new project

```bash
go-scaffold create my-api                                   # interactive wizard
go-scaffold create my-api --defaults                        # no prompts, CI-friendly
go-scaffold create my-api --defaults --no-docker --versioning
```

Produces a **bare skeleton only** — `cmd/api`, the shared platform packages
(config/apperror/dberr/httpx/id/middleware/pagination), Docker+Postgres,
migrations folder, and the standards docs (`docs/architect/`, `AGENTS.md`,
`CLAUDE.md`, `.claude/skills/go-scaffold/`). No domain modules — add those
with `generate module`.

| Option | Effect |
|---|---|
| `--defaults` | Skip the wizard, use defaults (Docker on, OpenAPI docs on, versioning off) |
| `--no-docker` | Skip `docker-compose.yml` (with `--defaults`) |
| `--no-openapi-docs` | Skip `docs/openapi.yaml` (with `--defaults`) |
| `--versioning` | Enable folder-based domain versioning (with `--defaults`) |

Without `--defaults`, an interactive wizard asks the same three questions.

**Config file** — every `create` writes `go-scaffold.config.json` to the
project root; `generate` reads it back (or auto-detects from `go.mod` /
directory layout if missing).

### `generate module <name>` (alias `m`) — add a domain module

```bash
go-scaffold generate module orders                  # full CRUD (default)
go-scaffold generate module orders --no-full         # minimal skeleton — add endpoints with `generate method`
go-scaffold g m orders --module-version v2   # versioned projects only
```

Full CRUD (default) scaffolds:

```text
internal/app/{{v1/}}orders/
├── model/model.go      # domain model + GORM table (id/created_at/updated_at — add real fields yourself; a folder so multi-table domains can add more files)
├── dto.go               # request/response structs (empty stubs — add real fields yourself)
├── errors.go             # ORDERS_NOT_FOUND / ORDERS_CONFLICT / ORDERS_HAS_REFERENCES
├── repository.go         # GORM data access
├── service.go            # business logic + repository interface (mockable)
├── handler.go            # Gin routes, registered under /v1/orders
├── service_test.go       # unit test, fake repo
└── handler_test.go       # integration test, real Postgres, tx rollback
```

`--no-full` scaffolds the same `model`/`errors`/`repository` (so `generate
method` always has a full data-access surface to call), but `dto`/`service`/
`handler` start empty — no default CRUD, no routes, just the plumbing
(`Register()`, the `repository` interface, `wrapFindErr`) that `generate
method` patches into. Use it when a domain doesn't need the full REST
surface, or you'd rather add endpoints one at a time.

Both modes also:

- Register the module in `cmd/api/main.go` (via marker comments — see
  `// go-scaffold:*` in that file) — full wires an actual route, minimal
  wires an empty route group
- Add the model to the `AutoMigrate(...)` call
- Append `migrations/<seq>_create_<plural>.{up,down}.sql`

What it does **not** do: invent your fields or wire foreign keys between
domains — see `docs/architect/patterns.md` in the generated project for the
conventions to follow by hand.

### `generate method <module> <name>` (alias `me`) — add one endpoint

```bash
go-scaffold generate method orders approve --type patch
go-scaffold generate method orders findByStatus --type get --get-mode one --field status
go-scaffold g me orders findOverdue --type get --get-mode all
```

Patches an *existing* module's `handler.go`/`service.go` in place via the
same marker-comment approach as `main.go` — never a whole new module. Never
overwrites a method with the same name; picks a different one or errors.

| Option | Effect |
|---|---|
| `--type <get\|post\|put\|patch\|delete>` | HTTP verb |
| `--get-mode <all\|one>` | For `get` only — list-style vs. single-record lookup |
| `--field <name>` | For `get --get-mode one` — the lookup field (e.g. `email`, `status`); can't be `id` |
| `--module-version <v>` | Target a specific version folder |

| `--type` | Route | What's generated |
|---|---|---|
| `get --get-mode all` | `GET /<plural>/<kebab-name>` | reuses `FindAll` — TODO to add real filtering |
| `get --get-mode one --field <f>` | `GET /<plural>/<f>/:<f>` | a real `FindBy<F>` query added to the repository (+ its interface + `fakeRepo` test stub) |
| `post` | `POST /<plural>/<kebab-name>` | adds a body DTO; service is a TODO stub |
| `put` / `patch` | `<VERB> /<plural>/:id/<kebab-name>` | finds by id, TODO before saving (safe no-op until implemented) |
| `delete` | `DELETE /<plural>/:id/<kebab-name>` | TODO stub |

Business logic is always left as a `TODO`-marked stub that compiles and
returns a clean `500` rather than inventing behavior — see
`docs/architect/patterns.md` in the generated project.

`generate method` prints the route it added but does **not** touch
`docs/openapi.yaml` — endpoint-specific spec entries stay hand-written.

### `remove module <name>` (alias `rm m`) — drop a domain

```bash
go-scaffold remove module orders          # confirms first
go-scaffold rm m orders --yes             # skip the confirm
```

The inverse of `generate module`: deletes `internal/app/<name>/` and reverses
everything that was wired up — the import/AutoMigrate/route in `main.go`, the
paths/schemas in `docs/openapi.yaml`, the per-module docs folder, and the
`create_<plural>` migration. Restores the `_ = v1` placeholder if it was the
last module, so the project still builds. Use this instead of hand-deleting
the folder — a partial hand-delete leaves stale wiring that duplicates on the
next `generate module` (which would panic gin at startup).

## Project structure produced by `create`

```text
cmd/api/main.go
internal/
├── platform/database/
├── shared/{config,apperror,dberr,httpx,id,middleware,pagination}/
└── app/                      # empty until you `generate module`
docs/
├── architect/{architecture,patterns,techstack}.md
└── openapi.yaml + common/ + health/   # if openapi docs enabled
migrations/
Makefile
.golangci.yml
.vscode/settings.json
AGENTS.md
CLAUDE.md
.claude/skills/go-scaffold/SKILL.md
go-scaffold.config.json
```

## Supported stack

| Package | Version |
|---|---|
| Gin | v1.10.0 |
| GORM + postgres driver | v1.25.12 / v1.5.9 |
| validator/v10 | v10.20.0 |
| google/uuid | v1.6.0 |

## License

MIT
