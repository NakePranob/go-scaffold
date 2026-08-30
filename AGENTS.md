# Agent Guidance: go-scaffold

This repository is the source for `@nakedev/go-scaffold`, not a generated Go
project. Changes here affect the CLI, its templates, and every project created
after the change. Preserve that distinction when deciding what to edit.

## Source of truth

- `src/` contains the CLI, configuration contract, patchers, and manifests.
- `templates/` contains the files emitted into generated projects.
- `tests/unit/` and `tests/integration/` cover CLI behavior and rendered trees;
  `scripts/smoke-test.mjs` exercises a fresh project with the external tools
  that generated projects rely on.
- `README.md` is the user and maintainer entry point. Generated-project
  guidance belongs in `templates/create/base/AGENTS.md.hbs` and
  `templates/create/base/.claude/skills/go-scaffold/SKILL.md.hbs`.

When a generated architecture or safety rule changes, update the relevant
template, the CLI that writes or patches it, and a test that proves the fresh
and incremental paths agree. Do not fix only a generated checkout and call the
generator fixed.

## Architecture contract emitted by this CLI

Generated projects use a modular monolith with a hexagonal split inside every
feature:

```text
internal/app/<feature>/
  domain/                  # entities and invariants
  application/             # service OR commands + queries
  ports/                   # consumer-owned interfaces
  adapters/inbound/http/   # Gin delivery adapter
  adapters/outbound/       # Postgres and other I/O adapters
  composition.go           # feature-local object graph
```

Service and CQRS are selectable application styles. They may coexist across
features, but never in one feature. `compat/` and feature-level `model/` are
not part of schema version 2; legacy CLI aliases are allowed only for command
invocation compatibility and must not recreate a second implementation tree.

The generated process root is `cmd/api/wiring.go`; feature composition stays
inside the feature. Auth and RBAC use the same boundary as ordinary domains.
Keep Gin, GORM, Redis, provider SDKs, and other I/O details out of domain and
new application code.

## Change workflow

1. Read the relevant command, manifest, patcher, template, and integration
   tests before editing. Preserve unrelated working-tree changes.
2. Make the smallest complete change and add a focused regression test. For a
   new generated surface, test both a fresh `create` path and the corresponding
   `add`/`generate` path when both are supported.
3. Build and run the full verification suite:

   ```bash
   pnpm install --frozen-lockfile
   pnpm run verify
   ```

   `verify` runs TypeScript build, unit tests, integration tests, and the smoke
   suite. The smoke suite needs Go, PostgreSQL/migrate, and golangci-lint; a
   skipped external check is not evidence that generated output is healthy.
4. For architecture changes, generate a fresh project with
   `node bin/go-scaffold.js create <name> --defaults`, run
   `go-scaffold check` after generating modules, and inspect the physical tree
   plus `go test ./...`, `go vet ./...`, and `gofmt` output.
5. Review `git diff --check`, the complete diff, and `git status --short`.

## Documentation and generated-project safety

- Generated docs describe the actual resolved configuration, including
  optional auth, worker, RBAC, observability, and OpenAPI features.
- Incremental feature commands may refresh untouched generated docs, but must
  leave hand-edited docs alone and report which files were skipped.
- `go-scaffold.config.json` is the contract for the generated tree. Reject
  unsupported schema versions instead of silently producing a mixed layout.
- Generated endpoint bodies are explicit TODO/501 stubs until an engineer adds
  business rules, authorization, persistence behavior, tests, and OpenAPI
  responses. The CLI must not imply that scaffolding equals production logic.

## Release

`package.json` is the version source. The release workflow publishes only an
annotated `vX.Y.Z` tag whose commit matches that version and has a clean tree.
Before a release, run `pnpm run release:check -- vX.Y.Z` on the exact tagged
commit; the GitHub workflow then runs the same verification gate before npm
publish and GitHub Release creation.
