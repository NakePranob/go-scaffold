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
npm install -g @nakedev/go-scaffold
```

Or run it without installing:

```bash
npx @nakedev/go-scaffold create my-api
```

Working on the CLI itself (not just using it)? Clone the repo, then:

```bash
pnpm install
pnpm run build
node bin/go-scaffold.js create my-api --defaults
```

`npm link` / `pnpm link --global` may not put the binary on your `PATH`
depending on your machine's npm/pnpm global-bin config — running
`node bin/go-scaffold.js ...` directly sidesteps that.

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
go-scaffold create my-api --defaults --no-docker --api-prefix beta
```

Produces a **bare skeleton only** — `cmd/api`, the shared platform packages
(config/apperror/dberr/httpx/id/middleware/pagination), Docker+Postgres,
migrations folder, and the standards docs (`docs/architect/`, `AGENTS.md`,
`CLAUDE.md`, `.claude/skills/go-scaffold/`). No domain modules — add those
with `generate module`.

| Option | Effect |
|---|---|
| `--defaults` | Skip the wizard, use defaults (Docker on, OpenAPI docs on, prefix `v1`) |
| `--no-docker` | Skip `docker-compose.yml` (with `--defaults`) |
| `--no-openapi-docs` | Skip `docs/openapi.yaml` (with `--defaults`) |
| `--api-prefix <prefix>` | URL prefix every route is grouped under (with `--defaults`; default `v1`, `""` for none, `/`-separated segments like `api/v1` are fine) |

Without `--defaults`, an interactive wizard asks the same three questions.
The prefix is a single project-wide choice made once at `create` time —
there's no per-domain versioning (a domain that needs a real breaking change
gets a new domain package or a new DTO field, not a duplicated model pointed
at the same table under a different URL — see "Why no per-domain versioning"
below).

**Config file** — every `create` writes `go-scaffold.config.json` to the
project root; `generate` reads it back (or auto-detects from `go.mod` /
directory layout if missing).

### `generate module <name>` (alias `m`) — add a domain module

```bash
go-scaffold generate module orders                  # safe minimal module (default)
go-scaffold generate module orders --full           # opt-in CRUD skeleton
```

`--full` scaffolds:

```text
internal/app/order/
├── model/model.go      # domain model + GORM table (id/created_at/updated_at — add real fields yourself; a folder so multi-table domains can add more files)
├── dto.go               # request/response structs (empty stubs — add real fields yourself)
├── errors.go             # ORDER_NOT_FOUND / ORDER_CONFLICT / ORDER_HAS_REFERENCES
├── repository.go         # GORM data access
├── service.go            # business logic + repository interface (mockable)
├── handler.go            # Gin routes, registered under the project's API prefix
├── service_test.go       # unit test, function-backed repository stub
├── handler_test.go       # HTTP unit test, service stub, no DB
└── repository_test.go    # Postgres integration test against migrated schema
```

The default minimal mode scaffolds the same `model`/`errors`/`repository` (so `generate
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

| `--type` | Route | What's generated |
|---|---|---|
| `get --get-mode all` | `GET /<plural>/<kebab-name>` | reuses `FindAll` — TODO to add real filtering |
| `get --get-mode one --field <f>` | `GET /<plural>/<f>/:<f>` | a real `FindBy<F>` query added to the repository (+ its interface + function-backed repository test stub) |
| `post` | `POST /<plural>/<kebab-name>` | adds a body DTO; service is a TODO stub |
| `put` / `patch` | `<VERB> /<plural>/:id/<kebab-name>` | finds by id, TODO before saving (safe no-op until implemented) |
| `delete` | `DELETE /<plural>/:id/<kebab-name>` | TODO stub |

Business logic is always left as a `TODO`-marked stub that compiles and
returns a clean `500` rather than inventing behavior — see
`docs/architect/patterns.md` in the generated project.

When OpenAPI docs are enabled, `generate method` also creates a valid TODO stub
under `docs/<plural>/methods/` and wires the route into `docs/openapi.yaml`.
Replace its placeholder request/response schemas while implementing the TODO.

**Drift check** — `generate` type-checks the project (`go vet ./...`) before and
after it writes. If the project was fine beforehand and the generated code
doesn't compile, it stops with the compiler output instead of leaving you to
find it later:

```text
the generated code doesn't compile, but this project was fine a moment ago.

The most likely cause is drift: this project's internal/shared layer has been edited
since it was scaffolded, so the templates this CLI emits no longer match it.

  scaffolded with: go-scaffold 0.1.2
  this CLI:        go-scaffold 0.3.0
```

That happens because `generate`'s templates are written against the `shared/`
layer `create` emits — editing that layer is normal work, but it moves the
project away from what this CLI's templates expect. `create` records its own
version in `go-scaffold.config.json` so the message can name both sides. A
project that was *already* broken (mid-refactor, or `go mod tidy` not run yet)
is left alone — only a passed-before/broken-after transition is reported. No Go
on `PATH` means the check is skipped.

### `generate migration <name>` (alias `mig`) — reserve a SQL migration pair

```bash
go-scaffold generate migration add_status_to_orders
```

Creates timestamped `migrations/<version>_<name>.up.sql` and `.down.sql` TODO
stubs. The CLI reserves the names; you own the SQL and should apply it with
`make migrate-up` (or `migrate -path migrations -database "$DB_DSN" up`).

### `add worker` — add background job processing

```bash
go-scaffold add worker                      # asks where jobs should live
go-scaffold add worker --queue postgres     # River (default)
go-scaffold add worker --queue redis        # Asynq
go-scaffold add worker --defaults           # no prompt, Postgres
```

Adds `internal/platform/queue` (a backend-neutral contract plus one adapter),
async email delivery, and `cmd/worker`.

| | `--queue postgres` (River) | `--queue redis` (Asynq) |
|---|---|---|
| Extra service to run | none | Redis |
| Enqueue joins your DB transaction | yes | **no** — needs an outbox |
| Throughput | thousands/sec | tens of thousands/sec |
| Inspect pending jobs | plain SQL | asynqmon |

The default is Postgres because a job enqueued inside `tx.Do` is then only
delivered if that transaction commits — no more welcome emails for signups
that rolled back. Run `make river-migrate` once per database to create
River's tables, then `make worker`.

Application code only ever sees `queue.Job`, `queue.Enqueuer` and
`queue.Handler` — no backend package appears outside its own adapter file, so
switching later means writing one adapter, not touching every module that
enqueues something.

```go
type WelcomeEmail struct{ To string `json:"to"` }
func (WelcomeEmail) Kind() string { return "email:welcome" }

// cmd/api — the job is discarded with the transaction if this fails
tx.Do(ctx, db, func(ctx context.Context) error {
    if err := repo.Create(ctx, u); err != nil { return err }
    return jobs.Enqueue(ctx, WelcomeEmail{To: u.Email}, nil)
})
```

### `add auth` — add email/password authentication

```bash
go-scaffold add auth
```

Requires `add worker` (verification and password-reset emails go through the
queue). The refresh-token store needs Redis regardless of the queue backend,
so `add auth` adds `internal/platform/cache` itself when the project doesn't
have it yet. Adds JWT access tokens, Redis-backed refresh-token
rotation, registration/login/logout, password reset, email verification, and
Google OAuth routes. Apply the generated migrations; `AUTO_MIGRATE=true` is
convenient in development, while production should use `migrate up`.

### `add rbac` — add roles and permissions

```bash
go-scaffold add rbac
go-scaffold generate module secrets --auth --permission secret:manage
```

Requires `add auth`. Adds role/permission administration, cached authorization
middleware, and role assignment. Its migration seeds the default roles and
permissions, so apply it with `migrate up`: AutoMigrate creates tables but does
not run SQL seed statements.

### Observability at project creation

```bash
go-scaffold create my-api --defaults --observability
```

Opt-in observability adds Prometheus metrics at `/metrics` and OpenTelemetry
tracing. Tracing is disabled until `OTEL_EXPORTER_OTLP_ENDPOINT` is configured.

### `remove module <name>` (alias `rm m`) — drop a domain

```bash
go-scaffold remove module orders          # confirms first
go-scaffold rm m orders --yes             # skip the confirm
```

The inverse of `generate module`: deletes `internal/app/<name>/` and reverses
the import/AutoMigrate/route in `main.go`, paths/schemas in `docs/openapi.yaml`,
and the per-module docs folder. **Existing migrations are preserved** because
production may already have recorded those immutable versions. The table/data
are also untouched; create a new `generate migration drop_<table>` migration
when removal is intentional. Restores the `_ = api` placeholder if it was the
last module, so the project still builds. Use this instead of hand-deleting
the folder — a partial hand-delete leaves stale wiring that duplicates on the
next `generate module` (which would panic gin at startup).

## Why no per-domain versioning

Earlier versions of this CLI let a domain live in a `v1/`/`v2/` folder with
its own route group and import alias, so the same domain name could exist
twice with different behavior. It was cut: the migration (and usually the
DB table) is shared between "versions" of the same domain, but each version
got its own physically-copied `model.go` — nothing stopped the two structs
from drifting apart. Verified against a real Postgres instance:
`AutoMigrate` silently accepted a column typed `int` in one version's model
and `float64` in the other for the *same* column, converging it to
`numeric` with no error — the two versions would then read/write the same
data with different, silently incompatible interpretations.

Instead, every route in a project is grouped under a single project-wide
`--api-prefix` (default `v1`) chosen once at `create` time. A domain that
needs a real breaking change gets a new domain package, or a new field on
the existing DTO — not a duplicated model pointed at a table it can drift
out of sync with.

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
.github/workflows/ci.yml    # build, vet, gofmt check, golangci-lint, go test (with a Postgres service)
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
