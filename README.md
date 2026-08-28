# @nakedev/go-scaffold

A CLI that scaffolds a Gin + GORM + PostgreSQL Go backend, then keeps
generating consistent domain modules into that project as it grows — the Go
counterpart to nest-scaffold.

You don't hand-wire a new domain's repository/service/handler composition into
`cmd/api/wiring.go`, write the
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
make db-create   # create the database itself (safe to re-run)
go mod tidy
make run
```

Then grow the project without leaving the CLI:

```bash
go-scaffold generate module orders
go-scaffold generate method orders approve --type patch
```

## Commands

Every `add` command shows what it's about to do and asks before writing;
`-y/--yes` skips that (and `--defaults` implies it) for CI and scripts.
Running `go-scaffold` with no arguments picks the command from a menu.

### Wizard coverage

The interactive path is deliberately available from both the bare command and
the direct command form:

| Command | Wizard coverage |
|---|---|
| `create [name]` | asks for the project name and settings that were not passed as flags |
| `generate` / `generate module [name]` | chooses a target, module name, and module profile; `Advanced` asks the two underlying architecture questions |
| `generate method [module] [name]` | asks for the existing module, method name, HTTP verb, GET mode, and lookup field when needed |
| `generate migration [name]` | asks for the migration name when omitted |
| `config` | edits future module defaults; existing modules are unchanged |
| `config show` / `config validate` | intentionally no wizard: read-only print/validation commands |
| `add` / `add worker` / `add auth` | chooses the feature, backend/topology, and confirmation where applicable |
| `add rbac` / `add observability` | no parameter choice is needed; the direct command confirms, while bare `add` selects the target |
| `undo` / `undo module [name]` | asks for the generated module and confirmation when omitted |

Run any command with `--help` for the non-interactive equivalent. If a value is
omitted in a non-TTY shell, the CLI exits before writing and tells you which
flag or `--defaults` is required.


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
| `--defaults` | Skip settings prompts; use Docker/OpenAPI on, no prefix, and Lean (`minimal + service`) defaults for future modules |
| `--no-docker` | Do not create `docker-compose.yml` or include a local Postgres service |
| `--no-openapi-docs` | Do not create `docs/openapi.yaml` or per-module OpenAPI files |
| `--observability` | Include Prometheus `/metrics` + OpenTelemetry tracing; off unless passed |
| `--api-prefix <prefix>` | Group every API route under a prefix such as `v1` or `api/v1`; omit for no prefix |
| `--module-profile <lean\|crud\|cqrs>` | Default profile for future modules; replaces the two architecture questions |
| `--module-surface <minimal\|crud>` | Legacy axis flag for future modules; use `--module-profile` for a clearer preset |
| `--application-style <service\|cqrs>` | Legacy axis flag for future modules; use `--module-profile` for a clearer preset |

Without `--defaults`, an interactive wizard asks the project questions —
skipping any a flag already answered, so `create my-api --no-docker` never asks
about Docker and never scaffolds it. It also asks for the default module
profile so future `generate module` commands start with the project's
conventions. Choose `Advanced` when you intentionally want the less common
CRUD + CQRS combination.
The prefix is a single project-wide choice made once at `create` time —
there's no per-domain versioning (a domain that needs a real breaking change
gets a new domain package or a new DTO field, not a duplicated model pointed
at the same table under a different URL — see "Why no per-domain versioning"
below).

**Config file** — every `create` writes `go-scaffold.config.json` to the
project root; `generate` reads it back (or auto-detects from `go.mod` /
directory layout if missing). It records project defaults and the resolved
surface/application style of each generated module:

```json
{
  "schemaVersion": 1,
  "architecture": {
    "style": "modular-monolith",
    "defaultModuleSurface": "minimal",
    "defaultApplicationStyle": "service"
  },
  "modules": {
    "order": { "surface": "crud", "applicationStyle": "cqrs" }
  }
}
```

Use the wizard again later without recreating the project:

```bash
go-scaffold config                 # interactive project-default wizard
go-scaffold config show            # print the resolved config
go-scaffold config validate        # validate without changing anything
```

### Module profiles

The wizard asks for one useful profile instead of forcing everyone to reason
about two implementation axes up front:

| Profile | Resolves to | Use it when |
|---|---|---|
| `lean` | minimal surface + one service | the domain should start small and grow endpoint by endpoint |
| `crud` | CRUD surface + one service | the domain genuinely needs the standard list/get/create/update/delete starter |
| `cqrs` | minimal surface + command/query handlers | reads and writes have different business models, invariants, or scaling pressure |
| `Advanced` (wizard only) | choose both axes separately | you deliberately want a custom mix, including CRUD + CQRS |

`minimal` does not mean “weak DDD”; it means the generator does not invent five
endpoints before the domain has real requirements. `CQRS` does not mean a second
database, broker, or event bus here. It only separates command and query
application handlers inside the same modular monolith.

### `generate module <name>` (alias `m`) — add a domain module

```bash
go-scaffold generate module orders                  # asks for profile (and auth, if installed)
go-scaffold generate module orders --profile lean   # explicit Lean profile, no architecture prompt
go-scaffold generate module orders --profile crud   # explicit CRUD profile, no architecture prompt
go-scaffold generate module orders --profile cqrs   # explicit CQRS profile, no architecture prompt
go-scaffold generate module orders --full --cqrs    # legacy flags: CRUD + separate command/query handlers
go-scaffold generate module orders --defaults       # use project defaults, no prompt (CI/scripting)
```

Anything you don't pass as a flag is asked for; the prompt starts with the
project defaults. `--defaults` uses those defaults without asking anything
(fresh and legacy projects default to Lean, with no auth). `--profile` is the
non-interactive equivalent of choosing a named profile for this module. The
older `--full` and `--cqrs` flags remain supported for existing scripts; do not
combine them with `--profile`.

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

Add `--cqrs` when this feature has meaningful command/query differences:

```text
internal/app/order/
├── commands.go            # command port + state-changing application handlers
├── queries.go             # query port + read-only application handlers
├── service.go             # compatibility facade; new wiring uses both handlers
└── composition.go         # constructs command/query handlers separately
```

`--cqrs` works with both minimal and `--full` modules. It keeps one modular
monolith and one database by default; CQRS here means separate application
paths, not mandatory separate databases, brokers, or event sourcing. The
default remains the simpler layered module because an empty command/query
split adds ceremony without a business reason.

The default minimal mode scaffolds the same `model`/`errors`/`repository` (so `generate
method` always has a full data-access surface to call), but `dto`/`service`/
`handler` start empty — no default CRUD, no routes, just the plumbing
(`Register()`, the `repository` interface, `wrapFindErr`) that `generate
method` patches into. Use it when a domain doesn't need the full REST
surface, or you'd rather add endpoints one at a time.

Both modes also:

- Register the module through its feature-local composition and the root
  registration markers in `cmd/api/wiring.go` — full wires an actual route,
  minimal wires an empty route group
- Create the module's own Postgres schema (`<module>_svc`, e.g. `order_svc`)
  and add the model to the development schema bootstrap
- Append `migrations/<timestamp>_create_<plural>.{up,down}.sql`, which creates that
  same schema for production
- Record the resolved `minimal|crud` and `service|cqrs` choices in
  `go-scaffold.config.json`; changing project defaults does not rewrite existing modules

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
For a module generated with `--cqrs`, it also patches `commands.go` for
state-changing endpoints and `queries.go` for read endpoints, while keeping
the compatibility facade in sync.

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
go-scaffold add auth                    # asks token store + browser topology, then confirms
go-scaffold add auth --store postgres   # tokens in Postgres, no extra service
go-scaffold add auth --store redis      # tokens in Redis, exact across replicas
go-scaffold add auth --defaults         # Postgres + local same-site topology (CI/scripting)
go-scaffold add auth --browser-topology cross-site --yes
```

Adds JWT access tokens, refresh-token rotation with reuse detection,
registration/login/logout, password reset, email verification, failed-login
lockout, and generic provider OAuth routes (Google is the first adapter). Apply
the generated migrations. Development may bootstrap tables for convenience;
production must run `migrate up` first.

The browser frontend owns its single provider callback route. It generates
`state` and an S256 PKCE verifier/challenge, starts
`GET /auth/{provider}/login`, handles both success and provider-cancel/error
responses in that route, then sends `code`, `state`, and `code_verifier` to
`POST /auth/{provider}/exchange`. The API uses the exact
`GOOGLE_OAUTH_REDIRECT_URI` registered with the provider, creates the local
session, sets the HttpOnly refresh cookie, and returns JSON. The backend also
consumes a one-time transaction binding provider, state, S256 challenge, and
OIDC nonce before completing the exchange. It never accepts a
request-supplied `redirect_uri`/`return_to`, redirects to a configured frontend
URL, or places tokens/code/state in a URI. Native/mobile flow is out of scope
for this scaffold phase.

`AUTH_BROWSER_TOPOLOGY` is only the cookie/CORS deployment policy, separate
from the provider redirect URI. For a genuinely cross-site frontend use
`--browser-topology cross-site`, deploy over HTTPS, set
`COOKIE_SAMESITE=none` and `COOKIE_SECURE=true`, and add the exact frontend
origin to `CORS_ALLOWED_ORIGINS` separately. SameSite=None requests also pass
an exact Origin guard because CORS alone is not CSRF protection. Token
responses use `Cache-Control: no-store` and `Pragma: no-cache`; configure
`JWT_REFRESH_MAX_TTL_MIN` so refresh rotation cannot extend beyond its absolute
lifetime.

No prerequisites. On a project with no worker the verification and reset mail
is sent inline, and `add worker` later moves it onto the queue for you — the
two endpoints that send mail block on SMTP until you do.

| `--store` | Refresh/recovery tokens and rate-limit counters | Extra service |
|---|---|---|
| `postgres` (default) | `user_svc.auth_tokens`, counters in-process | none |
| `redis` | refresh + rate-limit counters in Redis; recovery in `user_svc.auth_tokens` | Redis |

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
permissions, so apply it with `migrate up`; table creation does not run SQL
seed statements.

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
the module's migration files**, and reverses the import/bootstrap/route in
`cmd/api/wiring.go` plus the paths/schemas in `docs/openapi.yaml`. Restores the
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
development schema bootstrapping silently accepted a column typed `int` in
one version's model and `float64` in the other for the *same* column, converging it to
`numeric` with no error — the two versions would then read/write the same
data with different, silently incompatible interpretations.

Instead, every route in a project is grouped under a single project-wide
`--api-prefix` chosen once at `create` time — opt-in, no prefix unless you ask. A domain that
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
