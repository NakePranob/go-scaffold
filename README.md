# @nakedev/go-scaffold

A CLI that scaffolds a Gin + GORM + PostgreSQL Go backend, then keeps
generating consistent domain modules into that project as it grows — the Go
counterpart to nest-scaffold.

You don't hand-wire a new domain into `cmd/api/wiring.go`, write the
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
(config/apperror/dberr/httpx/id/middleware/pagination/tx), Docker+Postgres,
migrations folder, and the standards docs (`docs/architect/`, `AGENTS.md`,
`CLAUDE.md`, `.claude/skills/go-scaffold/`). No domain modules — add those
with `generate module`.

| Option | Effect |
|---|---|
| `--defaults` | Skip the wizard, use defaults (Docker on, OpenAPI docs on, prefix `v1`) |
| `--no-docker` | Skip `docker-compose.yml` (with `--defaults`) |
| `--no-openapi-docs` | Skip `docs/openapi.yaml` (with `--defaults`) |
| `--observability` | Prometheus `/metrics` + OpenTelemetry tracing (with `--defaults`; off by default — `add observability` does the same later) |
| `--api-prefix <prefix>` | URL prefix every route is grouped under (with `--defaults`; default `v1`, `""` for none, `/`-separated segments like `api/v1` are fine) |

Without `--defaults`, an interactive wizard asks the same four questions.
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
├── errors.go             # ORDER_NOT_FOUND / ORDER_CONFLICT / ORDER_HAS_REFERENCES / ORDER_STALE
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

- Register the module in `cmd/api/wiring.go` (via marker comments — see
  `// go-scaffold:*` in that file) — full wires an actual route, minimal
  wires an empty route group
- Create the module's own Postgres schema (`<module>_svc`, e.g. `order_svc`)
  and add the model to the `AutoMigrate(...)` call
- Append `migrations/<timestamp>_create_<plural>.{up,down}.sql`, which creates that
  same schema for `AUTO_MIGRATE=false`/production

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
| Needed by `add auth` | no | no — `add auth --store` decides that separately |
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
go-scaffold add auth                    # tokens in Postgres, no extra service
go-scaffold add auth --store redis      # tokens in Redis, exact across replicas
```

Adds JWT access tokens, refresh-token rotation with reuse detection,
registration/login/logout, password reset, email verification, failed-login
lockout, and Google OAuth routes. Apply the generated migrations;
`AUTO_MIGRATE=true` is convenient in development, while production should use
`migrate up`.

No prerequisites. On a project with no worker the verification and reset mail
is sent inline, and `add worker` later moves it onto the queue for you — the
two endpoints that send mail block on SMTP until you do.

| `--store` | Tokens and rate-limit counters | Extra service |
|---|---|---|
| `postgres` (default) | `user_svc.auth_tokens`, counters in-process | none |
| `redis` | Redis | Redis |

The rate limiter follows the store rather than being chosen separately, because
"I want this exact across replicas" is one decision. With `postgres` the per-IP
budget is per-replica; the failed-login lockout is in Postgres either way, since
that one can't be approximate.

### `add rbac` — add roles and permissions

```bash
go-scaffold add rbac
go-scaffold generate module secrets --auth --permission secret:manage
```

Requires `add auth`. Adds role/permission administration, cached authorization
middleware, and role assignment. Its migration seeds the default roles and
permissions, so apply it with `migrate up`: AutoMigrate creates tables but does
not run SQL seed statements.

### `add observability` — add metrics + tracing

```bash
go-scaffold add observability                          # on an existing project
go-scaffold create my-api --defaults --observability    # or at creation time
```

Adds Prometheus metrics at `/metrics` and OpenTelemetry tracing for Gin +
GORM, patched into `cmd/api/wiring.go` and `internal/platform/database` the same
way `add worker`/`add auth`/`add rbac` patch an existing project. Tracing is
disabled until `OTEL_EXPORTER_OTLP_ENDPOINT` is configured; `/metrics` works
either way. `create --observability` is exactly this command run right after
scaffolding — the two produce the same project.

### `undo module <name>` (alias `undo m`) — take back a `generate module`

```bash
go-scaffold undo module orders          # confirms first
go-scaffold undo m orders --yes         # skip the confirm
```

The inverse of `generate module`, for the case it's actually the inverse of:
a module you didn't mean to generate — a typo'd name, a domain you decided
against. It deletes `internal/app/<name>/`, the per-module docs folder, **and
the module's migration files**, and reverses the import/AutoMigrate/route in
`main.go` plus the paths/schemas in `docs/openapi.yaml`. Restores the
`_ = api` placeholder if it was the last module, so the project still builds.

Deleting the migrations is the point. `migrations/embed.go` is a `//go:embed
*`, so a typo'd `create_oders` left behind once ran on every database created
from then on. That's only safe while those files exist nowhere but your
working tree, so `undo` proves it first and refuses loudly otherwise:

- **any of them is tracked by git** — it may already have been pulled or
  deployed somewhere, so nothing is deleted. Retire that domain the explicit
  way instead: `go-scaffold generate migration drop_<name>`.
- **your database is already at or past that version** (read via the `migrate`
  CLI when it's on `PATH` and a DSN is configured) — deleting the files would
  strand `schema_migrations` at a version with no migration behind it. Run
  `migrate ... down` first, then try again.

The table itself is never dropped either way — `undo` only reverses what the
CLI wrote. Prefer it to hand-deleting the folder: it also un-wires `main.go`,
`.golangci.yml` and the OpenAPI index, and it refuses when another domain
still imports this one rather than leaving you an un-compilable project.

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
cmd/api/wiring.go
internal/
├── platform/database/
├── shared/{config,apperror,dberr,httpx,id,middleware,pagination,tx}/
└── app/                      # empty until you `generate module`
docs/
├── architect/{architecture,patterns,techstack}.md
└── openapi.yaml + common/ + health/   # if openapi docs enabled
migrations/
.github/workflows/ci.yml    # build, vet, gofmt check, golangci-lint, go test (with a Postgres service)
Makefile
.env.example
.gitignore
.golangci.yml
redocly.yaml                # if openapi docs enabled
docker-compose.yml          # if Docker enabled
.vscode/settings.json
README.md
AGENTS.md
CLAUDE.md
.claude/skills/go-scaffold/SKILL.md
go-scaffold.config.json
```

## Supported stack

Pinned in the generated `go.mod` — this table mirrors
`templates/create/base/go.mod.hbs`, which is the source of truth.

| Package | Version |
|---|---|
| Gin | v1.10.1 |
| GORM + postgres driver | v1.31.2 / v1.6.2 |
| validator/v10 | v10.30.3 |
| google/uuid | v1.6.0 |

## License

MIT
