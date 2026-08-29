# @nakedev/go-scaffold

@nakedev/go-scaffold is an npm CLI for creating Gin + GORM + PostgreSQL Go
backend projects and extending them with consistent domain modules, endpoints,
migrations, authentication, background jobs, RBAC, and observability.

The normal workflow is simple: install the CLI with npm, run the wizard, then
run the same CLI from the generated project whenever the backend grows.

## Install with npm

Install the CLI globally when you expect to use it repeatedly:

~~~bash
npm install --global @nakedev/go-scaffold

go-scaffold --version
go-scaffold --help
~~~

npx is also supported when you do not want a global installation:

~~~bash
npx @nakedev/go-scaffold create my-api
npx @nakedev/go-scaffold --help
~~~

### Requirements

- Node.js >=22.13 to run the CLI. npm and npx are included with Node.js.
- Go >=1.25 to build and run the generated project.
- PostgreSQL to run the application. Docker is optional; create can generate
  a Docker Compose PostgreSQL service for local development.

The CLI itself only needs Node.js. Go and PostgreSQL are needed after a project
has been generated.

## Developing the CLI

This repository is the source for the CLI and its generated-project contract.
Keep command logic in `src/`, emitted files in `templates/`, and behavior
covered by `tests/`. Generated-project `AGENTS.md`, Claude skill guidance, and
`docs/architect/` files are template outputs; update the template and a
regression test when their contract changes.

```bash
pnpm install --frozen-lockfile
pnpm run build
pnpm run verify
node bin/go-scaffold.js create my-api --defaults
```

`pnpm run verify` is the required local gate: it builds the TypeScript CLI,
runs unit and integration tests, and runs the generated-project smoke suite.
The smoke suite needs the Go toolchain, PostgreSQL/migrate, and golangci-lint;
do not treat an unavailable external check as a passing generated-project
check. See [`AGENTS.md`](AGENTS.md) for the source/template/test workflow.

### Release contract

`package.json` is the version source. Releases are published by
[`.github/workflows/release.yml`](.github/workflows/release.yml) only from a
clean, matching annotated `vX.Y.Z` tag. Before pushing a release tag, verify
the exact commit with:

```bash
pnpm run release:check -- v0.5.0
```

The release workflow runs the full verification gate before npm publish and
GitHub Release creation.

## Quick start

~~~bash
npm install --global @nakedev/go-scaffold
go-scaffold create my-api

cd my-api
cp .env.example .env       # optional: edit local settings
make docker-up             # only when create included Docker + PostgreSQL
make db-create
go mod tidy
make run
~~~

The default create wizard includes Docker and OpenAPI files. If you choose
--no-docker, start PostgreSQL separately before running make db-create.

Add a first domain from the generated project directory:

~~~bash
go-scaffold generate module orders
go-scaffold generate method orders approve --type patch
~~~

The generated project starts with shared infrastructure and no business
domains. generate module adds the domain; generate method adds endpoints one
at a time.

## How the wizard works

You can use the CLI interactively or provide answers as arguments and flags.

### Start with the top-level wizard

Running the CLI without a command opens a menu:

~~~bash
go-scaffold
~~~

From a generated project directory, the menu offers:

1. Create a new project
2. Generate a module, method, or migration
3. Configure defaults for future modules
4. Add auth, worker, RBAC, or observability
5. Undo a generated module

When run outside a generated project, only create can run, so the CLI goes
straight to the project-creation flow.

You can also open a more focused wizard:

~~~bash
go-scaffold generate       # choose module, method, or migration
go-scaffold add            # choose worker, auth, RBAC, or observability
go-scaffold undo           # choose a generated module and confirm
~~~

### Answer only what is missing

The command is the first choice, followed by only the questions that still need
an answer. A value passed as a flag is not asked again.

For example:

~~~text
go-scaffold create my-api
  1. Docker + PostgreSQL?
  2. OpenAPI files?
  3. Metrics + tracing?
  4. API route prefix?
  5. Default module profile: Lean / CRUD / CQRS / Advanced?
  6. Create project with these settings?

cd my-api
go-scaffold generate module orders
  1. Module profile: Lean / CRUD / CQRS / Advanced?
  2. Require an access token?       # only when auth is installed
  3. Permission code?                # only when auth + RBAC are installed
~~~

Advanced is the wizard option that exposes the two lower-level module choices
separately: module surface and application boundary.

### Non-interactive usage

Use flags for scripts and CI. --defaults skips the optional wizard questions
where the command supports it. A project name is still required for scripted
create usage.

~~~bash
go-scaffold create my-api --defaults
go-scaffold generate module orders --defaults
go-scaffold add worker --defaults
go-scaffold add auth --defaults
~~~

Important behavior:

- In a terminal, omitted values open the relevant wizard.
- Without an interactive terminal, omitted values cause an error before files
  are written. Pass the missing flags or use --defaults.
- --yes / -y skips an add or undo confirmation. It does not necessarily answer
  every other wizard question; pass the choice flags too.
- Every add command shows a summary and asks for confirmation unless --yes or
  --defaults is used.
- Run any command with --help to see its current options.

## Command overview

| Command | Purpose | Alias |
|---|---|---|
| create [name] | Create a new Go backend project | c |
| check | Validate hexagonal layout, layer dependencies, and service/CQRS contract | — |
| generate | Open the module/method/migration wizard | g |
| generate module [name] | Add a domain module | g m |
| generate method [module] [name] | Add one endpoint to an existing module | g me |
| generate migration [name] | Create a timestamped SQL migration pair | g mig |
| config | Set defaults for future modules | — |
| config show | Print the resolved project configuration | — |
| config validate | Validate configuration without changing files | — |
| add | Open the infrastructure-feature wizard | — |
| add worker | Add background jobs, mail, and cmd/worker | — |
| add auth | Add email/password and provider authentication | — |
| add rbac | Add roles, permissions, and authorization middleware | — |
| add observability | Add Prometheus metrics and OpenTelemetry tracing | — |
| undo module [name] | Remove a generated module and its wiring | undo m |

All commands except create are intended to run from the generated project
directory.

## create [name] — create a project

~~~bash
go-scaffold create my-api                         # interactive wizard
go-scaffold create my-api --defaults              # use documented defaults
go-scaffold create my-api --defaults --no-docker
go-scaffold create my-api --api-prefix v1
go-scaffold c my-api
~~~

If [name] is omitted, the wizard asks for it. With a simple name, it becomes
both the project directory and the Go module path in the generated go.mod. A
full Go module path is also accepted; in that case the project directory uses
the path's final segment.

### Creation options

| Option | Effect |
|---|---|
| --defaults | Skip settings prompts; use Docker and OpenAPI, no API prefix, and Lean defaults for future modules |
| --no-docker | Do not create docker-compose.yml or a local PostgreSQL service |
| --no-openapi-docs | Do not create docs/openapi.yaml or OpenAPI files for generated features/modules |
| --observability | Include Prometheus /metrics and OpenTelemetry tracing at creation time |
| --api-prefix <prefix> | Put every API route under a prefix such as v1 or api/v1 |
| --module-profile <lean\|crud\|cqrs> | Set the default profile for future generate module commands |
| --module-surface <minimal\|crud> | Legacy way to set the future module surface; prefer --module-profile |
| --application-style <service\|cqrs> | Legacy way to set the future application boundary; prefer --module-profile |

The route prefix is a project-wide choice. For example, --api-prefix v1 puts a
module route under /v1/orders.

### What create generates

create produces a runnable base skeleton, not a business domain. It includes
the API entrypoint, shared packages, database connection, migrations folder,
development commands, and architecture documentation. Add domains later with
generate module.

Every project also gets go-scaffold.config.json. It stores the project defaults,
installed features, API prefix, and the resolved profile of each module so later
CLI commands can continue from the same choices.

## Module profiles

The module wizard presents a useful profile before exposing lower-level
architecture choices:

| Profile | Generated shape | Use it when |
|---|---|---|
| lean | Minimal surface + one service | The domain should start small and gain endpoints as requirements become real |
| crud | CRUD surface + one service | The domain needs list/get/create/update/delete starter endpoints |
| cqrs | Minimal surface + command/query handlers | Reads and writes have different application concerns |
| Advanced | Choose surface and application style separately | You need a custom combination, such as CRUD + CQRS |

minimal means no default CRUD endpoints are invented. CQRS separates the
command and query application paths inside the same modular monolith; it does
not add a second database, broker, or event-sourcing system.

The generated code is DDD-shaped: each domain has a package boundary,
repository port, application boundary, delivery adapter, and shared error
conventions. The CLI does not invent your aggregates, fields, value objects,
events, or business invariants.

## generate module [name] — add a domain

~~~bash
go-scaffold generate module orders                  # profile wizard
go-scaffold generate module orders --profile lean
go-scaffold generate module orders --profile crud
go-scaffold generate module orders --profile cqrs
go-scaffold generate module orders --defaults        # use project defaults
go-scaffold g m orders --profile crud
~~~

When no name is supplied, the wizard asks for a singular module name such as
order or product. The package name is normalised for Go, while routes and
tables use plural names such as orders and order_items.

### Module options

| Option | Effect |
|---|---|
| --profile <lean\|crud\|cqrs> | Select a named profile without opening the profile question |
| --full | Legacy alias for the CRUD surface |
| --cqrs | Legacy axis flag for command/query handlers; combine with --full for CRUD + CQRS |
| --auth | Require a valid access token for this module's routes; needs add auth |
| --permission <code> | Also require an RBAC permission such as orders:manage; needs add rbac and --auth |
| --defaults | Use the project's recorded module defaults, skip prompts, and keep the module public |

--profile cannot be combined with the legacy --full or --cqrs flags. With
--defaults, a fresh project generates the Lean shape. If the project has auth
installed, the module remains public unless --auth is explicitly passed.

### Module output

For orders, the module package is internal/app/order/:

~~~text
internal/app/order/
├── domain/
│   ├── entity.go        # business state and invariants
│   └── errors.go        # domain error sentinels
├── ports/
│   └── repository.go    # consumer-owned persistence ports
├── application/
│   ├── dto.go           # use-case inputs and response mapping
│   ├── service.go       # service-style application boundary
│   └── service_test.go  # application unit tests
├── adapters/
│   ├── inbound/http/
│   │   ├── handler.go       # Gin delivery adapter
│   │   └── handler_test.go  # HTTP adapter tests
│   └── outbound/postgres/
│       ├── model.go         # persistence model + mapping
│       ├── repository.go    # GORM adapter
│       └── repository_test.go # PostgreSQL integration tests
└── composition.go       # feature-local object graph
~~~

CRUD modules contain the starter list/get/create/update/delete methods. Lean
modules keep the endpoint surface small so it can be extended with
generate method.

CQRS modules additionally contain:

~~~text
internal/app/order/
└── application/
    ├── commands.go      # command port + state-changing handlers
    ├── queries.go       # query port + read-only handlers
    └── cqrs_test.go     # command/query boundary tests
~~~

`application/service.go` OR `application/commands.go` plus
`application/queries.go` is mutually exclusive inside one module. Service and
CQRS can coexist across modules in the same modular monolith. The root package
contains only `composition.go`; inbound and outbound adapters are the
framework/database edges.

Both shapes register the module in cmd/api/wiring.go, create a module-owned
PostgreSQL schema such as order_svc, append a timestamped create migration, and
record the resolved module profile in go-scaffold.config.json.

The CLI creates the structural TODOs, not your domain rules. Add real model and
DTO fields, implement business behavior, and review the generated migration
before applying it.

## generate method [module] [name] — add one endpoint

~~~bash
go-scaffold generate method orders approve --type patch
go-scaffold generate method orders findByStatus --type get --get-mode one --field status
go-scaffold g me orders findOverdue --type get --get-mode all
~~~

If the module, method name, or endpoint details are omitted, the wizard asks
for them. The module selector lists modules that exist on disk, so the command
does not require memorising the normalised Go package name.

### Method options

| Option | Effect |
|---|---|
| --type <get\|post\|put\|patch\|delete> | HTTP verb |
| --get-mode <all\|one> | For GET only: list endpoint or single-record lookup |
| --field <name> | For get --get-mode one: lookup column such as email, status, or slug; id is reserved |

The generated route and code depend on the method type:

| Input | Route shape | Result |
|---|---|---|
| get --get-mode all | GET /<plural>/<method> | Uses the module's list query; add real filtering yourself |
| get --get-mode one --field <field> | GET /<plural>/<field>/:<field> | Adds a FindBy<Field> query and a column/index migration |
| post | POST /<plural>/<method> | Adds a request body DTO and a TODO service method |
| put / patch | <VERB> /<plural>/:id/<method> | Loads by ID and leaves the update behavior as a TODO |
| delete | DELETE /<plural>/:id/<method> | Adds a delete endpoint stub |

For CQRS modules, GET methods are added to application/queries.go; other
methods are added to application/commands.go. Service modules use
application/service.go. Existing method names are never overwritten.

The generated business logic is deliberately a compiling TODO and returns a
clean not-implemented response until you implement it. If OpenAPI files were
enabled, a method document is also added under docs/<plural>/methods/ and
linked from docs/openapi.yaml.

## generate migration [name] — reserve a migration pair

~~~bash
go-scaffold generate migration add_status_to_orders
go-scaffold g mig add_status_to_orders
~~~

This creates:

~~~text
migrations/<timestamp>_add_status_to_orders.up.sql
migrations/<timestamp>_add_status_to_orders.down.sql
~~~

Both files contain TODO comments. The CLI reserves the timestamp and filename;
you write the SQL and then apply it with:

~~~bash
make migrate-up
~~~

## config — configure future module defaults

Run this from the generated project directory:

~~~bash
go-scaffold config                 # profile wizard
go-scaffold config show            # print JSON; no wizard
go-scaffold config validate        # validate; no file changes
~~~

config changes defaults for future modules only. Existing modules keep their
recorded surface and application style.

## add — add optional project features

Running go-scaffold add opens a feature wizard. It shows features already
installed as unavailable and explains that RBAC requires auth. Direct feature
commands are useful for scripts and explicit usage.

After an incremental feature is added, the CLI refreshes the generated
README and architect docs to reflect the resolved configuration. It only does
so when each file still matches the version it would have generated; edited
docs are preserved and reported for manual maintenance.

### add worker — background jobs and mail

~~~bash
go-scaffold add worker                         # queue wizard + confirmation
go-scaffold add worker --queue postgres        # River in PostgreSQL
go-scaffold add worker --queue redis           # Asynq in Redis
go-scaffold add worker --defaults              # PostgreSQL/River, no prompts
go-scaffold add worker --queue redis --yes     # skip confirmation
~~~

The command adds internal/platform/queue, mail delivery, and cmd/worker.

| Queue option | Storage | Operational note |
|---|---|---|
| postgres (River) | Project PostgreSQL database | No extra service; enqueueing can join the database transaction |
| redis (Asynq) | Redis | Run Redis separately; enqueueing cannot join a PostgreSQL transaction |

For River:

~~~bash
make river-migrate
make worker
~~~

For Redis, start Redis first and then run make worker. make dev runs the API and
worker together after worker support has been added.

### add auth — email/password and provider auth

~~~bash
go-scaffold add auth                                      # store + browser topology wizard
go-scaffold add auth --store postgres                     # no extra service
go-scaffold add auth --store redis                        # Redis for shared refresh state
go-scaffold add auth --browser-topology same-origin
go-scaffold add auth --browser-topology same-site
go-scaffold add auth --browser-topology cross-site
go-scaffold add auth --defaults                            # Postgres + same-site defaults
~~~

Auth adds:

- JWT access tokens and refresh-token rotation with reuse detection
- registration, login, logout, refresh, password reset, and email verification
- generic provider OAuth routes, with Google as the first adapter
- failed-login lockout and user-session management
- MFA endpoints and configuration hooks
- internal/app/user, auth middleware, cmd/seed, migrations, and OpenAPI
  documents when OpenAPI is enabled

The --store choice controls refresh-token storage and rate-limit counters:

| --store | Refresh/recovery token storage | Extra service |
|---|---|---|
| postgres (default) | PostgreSQL; rate-limit counters are in-process | None |
| redis | Refresh state and rate-limit counters in Redis; recovery remains in PostgreSQL | Redis |

--browser-topology describes how a browser frontend and API are deployed:

| Topology | Typical setup |
|---|---|
| same-origin | Same scheme, host, and port |
| same-site (default) | Different origin on the same site, such as localhost:3000 and localhost:8080 |
| cross-site | Different sites; use HTTPS, SameSite=None, secure cookies, and exact CORS origins |

After adding auth:

~~~bash
go mod tidy
make migrate-up
SEED_ADMIN_EMAIL=admin@example.com SEED_ADMIN_PASSWORD='change-me' make seed
~~~

Without add worker, verification and password-reset mail is sent inline. If a
worker is already installed, those jobs use the queue instead.

### add rbac — roles and permissions

~~~bash
go-scaffold add rbac
go-scaffold add rbac --yes
go-scaffold generate module secrets --profile lean --auth --permission secret:manage
~~~

RBAC requires add auth first. It adds:

- role and permission administration
- cached authorization middleware
- role assignment endpoints
- the internal/app/role module and its migration

Apply the migration before using the seeded roles and permissions:

~~~bash
make migrate-up
SEED_ADMIN_EMAIL=admin@example.com SEED_ADMIN_PASSWORD='change-me' make seed
~~~

### add observability — metrics and tracing

~~~bash
go-scaffold add observability
go-scaffold add observability --yes
go-scaffold create my-api --defaults --observability
~~~

This adds Prometheus GET /metrics and OpenTelemetry tracing for Gin and GORM.
Run go mod tidy after adding it. Metrics work immediately; set
OTEL_EXPORTER_OTLP_ENDPOINT when you want to export traces.

create --observability and create followed by add observability produce the same
feature configuration.

## undo module [name] — remove a generated module

~~~bash
go-scaffold undo module orders       # asks for confirmation
go-scaffold undo m orders --yes      # skip confirmation
go-scaffold undo                    # choose the module in a wizard
~~~

undo module removes the module package, its generated OpenAPI folder, owned
migrations, configuration entry, and wiring from cmd/api/wiring.go. It does not
drop a database table.

The command is intentionally conservative: it refuses when the module's
migrations may already have been shared or applied, or when another module
still depends on it. Use an explicit hand-written migration to retire a domain
that is already in use.

## Generated project structure

After go-scaffold create my-api, the important runtime structure is:

~~~text
my-api/
├── cmd/
│   └── api/
│       ├── main.go                 # process entrypoint and shutdown
│       └── wiring.go               # infrastructure and module composition
├── internal/
│   ├── platform/
│   │   └── database/               # GORM connection and pool
│   ├── shared/
│   │   ├── config/                 # environment configuration
│   │   ├── apperror/               # consistent application errors
│   │   ├── dberr/                  # database error classification
│   │   ├── httpx/                  # HTTP parsing and binding helpers
│   │   ├── id/                     # UUID generation
│   │   ├── middleware/             # request ID, logging, errors, CORS
│   │   ├── pagination/             # pagination parsing and responses
│   │   └── tx/                     # transaction context helpers
│   └── app/                        # empty until generate module is used
├── migrations/                     # embedded, versioned SQL migrations
├── docs/
│   ├── architect/                  # architecture, patterns, tech stack
│   └── openapi.yaml                # optional API index and referenced files
├── go-scaffold.config.json         # CLI defaults, features, and module choices
├── go.mod
├── Makefile
├── .env.example
├── Dockerfile
└── docker-compose.yml              # optional, when Docker was selected
~~~

Optional commands add these areas:

~~~text
add worker          -> internal/platform/{queue,mail}/ and cmd/worker/
add auth            -> internal/app/user/, auth middleware, and cmd/seed/
add rbac            -> internal/app/role/ and authorization middleware
add observability   -> internal/platform/telemetry/ and metrics/tracing middleware
~~~

After generate module orders, the domain sits behind its own package boundary:

~~~text
internal/app/order/
├── domain/              # entities, invariants, and domain errors
├── ports/               # consumer-owned application dependencies
├── application/         # service OR commands + queries, plus DTOs/tests
├── adapters/inbound/http/       # Gin delivery adapter and tests
├── adapters/outbound/postgres/ # persistence model, adapter, and tests
└── composition.go       # module-local dependency wiring
~~~

The generated service and CQRS styles are exclusive within a module: a
service module has `application/service.go`; a CQRS module has
`application/commands.go` and `application/queries.go` and no service facade.
Different modules may choose different styles. `go-scaffold check` enforces the
physical layout and dependency direction.

The module name orders produces the Go package order, REST collection /orders,
plural table names such as order_items, and a module-owned schema such as
order_svc.

## Useful commands after scaffolding

Run these from the generated project directory:

| Command | Purpose |
|---|---|
| make docker-up | Start the generated local PostgreSQL service |
| make docker-down | Stop the generated local services |
| make db-create | Create the project database; safe to run again |
| make run | Run cmd/api |
| make build | Build cmd/api into bin/api |
| make test | Run Go tests |
| make fmt | Format Go code |
| make vet | Run go vet ./... |
| make tidy | Run go mod tidy |
| make migrate-up | Apply migrations from migrations/ |
| make migrate-down | Roll back one migration |
| make migrate-verify | Check that migrations can roll forward and back |
| make openapi-bundle | Bundle OpenAPI $ref files when OpenAPI is enabled |

make run, make test, and migration targets load .env when it exists. Copy
.env.example to .env and adjust DB_DSN, PORT, CORS, mail, auth, or telemetry
settings as needed.

## What to edit after generation

The CLI gives you a compiling structure and explicit TODOs. Your application
still owns:

- domain fields and invariants in `domain/entity.go`
- request/use-case and response fields in `application/dto.go`
- persistence fields and mapping in `adapters/outbound/postgres/model.go`
- business rules in `application/service.go` or command/query handlers
- SQL bodies in generated migration files
- OpenAPI schemas and method descriptions
- tests for the behavior you add

Use go-scaffold generate method for the repetitive endpoint shape, then fill in
the generated TODO before treating the endpoint as production behavior.

## Architecture and migration note

Schema version 2 is the canonical hexagonal split layout. Every generated
feature, including auth and RBAC, uses `domain/`, `application/`, `ports/`,
`adapters/`, and a feature-local `composition.go`; one canonical implementation
tree is generated. Projects with the old schema 1 manifest are
rejected with a migration hint instead of silently generating a conflicting
architecture.

The generated tree has no `compat/` directory and no feature-level `model/`
directory. The word “compatibility” below refers only to CLI command aliases:
the hidden `remove module` alias remains supported for old scripts, while new
commands should use `go-scaffold undo module`.

## License

MIT
