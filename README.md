<div align="center">
  <img src="https://raw.githubusercontent.com/NakePranob/go-scaffold/main/.github/assets/readme/hero.png" alt="go-scaffold: a Go backend with boundaries, from day one" width="100%">
  <h1>go-scaffold</h1>
  <p><strong>A Go backend with boundaries, from day one.</strong></p>
  <p>
    <a href="https://www.npmjs.com/package/@nakedev/go-scaffold"><img src="https://img.shields.io/npm/v/@nakedev/go-scaffold.svg" alt="npm version"></a>
    <a href="https://nodejs.org"><img src="https://img.shields.io/node/v/@nakedev/go-scaffold.svg" alt="Node.js version"></a>
    <a href="https://github.com/NakePranob/go-scaffold/actions/workflows/ci.yml"><img src="https://github.com/NakePranob/go-scaffold/actions/workflows/ci.yml/badge.svg?branch=main" alt="CI"></a>
    <a href="LICENSE"><img src="https://img.shields.io/npm/l/@nakedev/go-scaffold.svg" alt="license"></a>
  </p>
</div>

`go-scaffold` is an npm CLI for creating **Gin + GORM + PostgreSQL** backends
with a consistent hexagonal shape. It creates the project, then keeps extending
it with domain modules, endpoints, migrations, auth, RBAC, background jobs, and
observability — without re-deciding the folder structure each time.

## Why go-scaffold

- **Boundaries before business logic.** Every module starts with `domain`,
  `application`, `ports`, and `adapters` in the same places.
- **One shape for every module.** `generate module` and `generate method` write
  the same wiring, tests, and docs every time.
- **The boring wiring is already done.** Auth, RBAC, migrations, background
  jobs, OpenAPI, metrics, and Docker are opt-in commands, not a checklist you
  rebuild by hand.

## Quick start

```bash
npm install --global @nakedev/go-scaffold
go-scaffold create my-api

cd my-api
cp .env.example .env       # optional: edit local settings
make docker-up             # only when create included Docker + PostgreSQL
make db-create
go mod tidy
make run
```

Add the first domain from inside the generated project:

```bash
go-scaffold generate module orders
go-scaffold generate method orders approve --type patch
```

The generated project starts with shared infrastructure and no business
domains. `generate module` adds the domain; `generate method` adds an endpoint
to it.

### Requirements

- **Node.js >=22.13** for the CLI.
- **Go >=1.25** for the generated project.
- **PostgreSQL** to run the application. Docker is optional.
- `npx @nakedev/go-scaffold ...` works if you do not want a global install.

## What you get

| Area | What `go-scaffold` gives you |
| --- | --- |
| **Architecture** | Domain modules with `domain`, `application`, `ports`, and `adapters`; a `check` command that enforces the layer rules. |
| **Auth** | Email/password and provider auth, sessions, refresh rotation, MFA, recovery codes, and ASVS-oriented security defaults. |
| **RBAC** | Roles and permissions with generated authorization middleware. |
| **Data** | Timestamped migration pairs, GORM models, repositories, and a migration verification workflow. |
| **Background jobs** | River (PostgreSQL) or Asynq (Redis) queues, mail delivery, and `cmd/worker`. |
| **Operations** | OpenAPI docs, Prometheus metrics, OpenTelemetry tracing, Docker Compose, and health endpoints. |
| **Agent guidance** | `AGENTS.md`, `CLAUDE.md`, and one repository-wide skill under `.agents/skills/go-scaffold/`. |

## How it fits together

![go-scaffold architecture: inbound adapters, application, domain, ports, and outbound adapters](https://raw.githubusercontent.com/NakePranob/go-scaffold/main/.github/assets/readme/architecture.png)

The HTTP adapter translates requests. The application layer owns the use case.
The domain owns the rules. Ports define what the application needs. Adapters
provide PostgreSQL, queues, mail, or other infrastructure. `go-scaffold check`
keeps those directions honest.

## Generated project

```text
my-api/
├─ cmd/api/                  # HTTP entrypoint
├─ cmd/worker/               # added by `add worker`
├─ internal/
│  ├─ app/<module>/          # domain, application, ports, adapters
│  └─ shared/                # config, database, HTTP, middleware, errors
├─ migrations/               # timestamped SQL pairs
├─ docs/architect/           # generated architecture notes
├─ AGENTS.md
├─ CLAUDE.md
└─ go-scaffold.config.json   # the generated-project contract
```

## Commands

| Command | What it does |
| --- | --- |
| `create [name]` | Create a new Go backend project. |
| `check` | Validate the hexagonal layout and layer dependencies. |
| `generate module [name]` | Add a domain module. Alias: `g m`. |
| `generate method [module] [name]` | Add one endpoint to an existing module. Alias: `g me`. |
| `generate migration [name]` | Reserve a timestamped SQL migration pair. Alias: `g mig`. |
| `config` | Set defaults for future modules. |
| `add worker` | Add background jobs, mail, and `cmd/worker`. |
| `add auth` | Add email/password and provider authentication. |
| `add rbac` | Add roles, permissions, and authorization middleware. |
| `add observability` | Add Prometheus metrics and OpenTelemetry tracing. |
| `undo module [name]` | Remove a generated module and its wiring. |

Run any command with `--help` for its current options. The full command
reference — wizard behavior, every option, generated output, and architecture
notes — lives in [`REFERENCE.md`](REFERENCE.md).

## Agent guidance

`create` writes agent guidance once per repository, not once per package:

- `AGENTS.md` and `CLAUDE.md` inside each generated package;
- `.agents/skills/go-scaffold/SKILL.md` at the repository root;
- `.claude/skills/go-scaffold` as a symlink to the `.agents` copy.

The skill tells an agent to locate the target package's
`go-scaffold.config.json`, `AGENTS.md`, and `docs/architect/` before acting. If
a skill with different content already exists, `create` reports it and leaves
it untouched.

## Learn more

- [Full command reference](REFERENCE.md)
- [Auth security checklist](docs/auth-security-checklist.md)
- [Source, template, and test workflow](AGENTS.md)
- [Contributing guide](CONTRIBUTING.md)

## Development

```bash
pnpm install --frozen-lockfile
pnpm run build
pnpm run verify
node bin/go-scaffold.js create my-api --defaults
```

`pnpm run verify` builds the CLI, runs unit and integration tests, and runs the
generated-project smoke suite. See [`AGENTS.md`](AGENTS.md) for the release
contract and the source/template/test workflow.

## License

MIT — see [LICENSE](LICENSE).
