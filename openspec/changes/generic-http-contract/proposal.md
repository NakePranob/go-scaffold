# Proposal

## Why

The generated HTTP layer does not have one generic response/error pattern:

- A generated module uses `appError` plus an `applicationError` wrapper
  (`templates/generate/module/.../handler.go.hbs:80`), auth uses
  `toHTTPError` (`templates/add/auth/.../handler.go.hbs:293`), and RBAC uses a
  second `toHTTPError` with a different switch
  (`templates/add/rbac/.../handler.go.hbs:119`).
- `generate method` has to find the module's error mapper by regex because the
  name and signature differ between generated modules, auth, and RBAC
  (`src/utils/hexagonal-method-patcher.ts:299-305`).
- Every success path writes JSON directly: 30 `c.JSON(...)` calls across the
  module, auth, and RBAC inbound templates. Lists use
  `pagination.ResponseWithTotal` (`{data, limit, offset, total}`), while
  single-resource, create, update, and delete responses each choose their own
  status and body.
- `architecture.md` claims “Handlers only ever do `c.Error(err); return` — no
  `c.JSON` per call site” (`templates/create/features/docs/architecture.md.hbs:120-124`),
  but that is true only on the error path.
- The error payload is documented in `README.md.hbs:282`, and the list envelope
  in `patterns.md.hbs:328`, but there is no single contract the generated
  skill, AGENTS file, and handlers all point to.

This is not a request to change the wire format. It is a request to make the
mechanism behind the current format generic, so the generator and every
generated module use one implementation and one documented contract.

## What Changes

- Add `apperror.Rule` and `apperror.Translate`: a module declares its
  domain-to-HTTP mapping as data, and the shared translator handles
  `*AppError` passthrough, `errors.Is` matching, and the internal fallback.
- Add `httpx.OK`, `httpx.Created`, `httpx.NoContent`, and `httpx.Page` as the
  only success-response writers used by generated inbound adapters.
- Migrate generated module, auth, and RBAC handlers to those helpers; remove
  `applicationError` and the duplicated `toHTTPError` switches.
- Make `generate method` emit the same helpers and stop depending on a
  per-module error-mapper name.
- Document the contract once in `docs/architect/http-contract.md` and point
  README, patterns, architecture, AGENTS, and the generated skill at it.
- Add `tests/qa/http-contract.test.mjs` with two tiers:
  - a regression tier that captures the current wire shapes and must stay
    green before and after the refactor;
  - a target tier that requires the generic helpers and generated source
    pattern and is expected to be red until the refactor lands.

## Capabilities

### New Capabilities

- `http/response-contract`: one success writer and stable item/list/delete
  payload shapes.
- `http/error-translation`: one generic domain-error translator with
  per-module rules and a single error envelope.

### Modified Capabilities

- None. This repository has no archived capability specs yet.

## Impact

- `templates/create/base/internal/shared/apperror/apperror.go.hbs`
- `templates/create/base/internal/shared/httpx/httpx.go.hbs`
- `templates/create/base/internal/shared/pagination/pagination.go.hbs`
- `templates/generate/module/hexagonal/adapters/inbound/http/*.hbs`
- `templates/add/auth/internal/app/user/adapters/inbound/http/*.hbs`
- `templates/add/rbac/internal/app/role/adapters/inbound/http/*.hbs`
- `src/utils/hexagonal-method-patcher.ts`
- `templates/create/features/docs/architecture.md.hbs`
- `templates/create/features/docs/patterns.md.hbs`
- `templates/create/base/README.md.hbs`
- `templates/create/base/AGENTS.md.hbs`
- `templates/create/base/.claude/skills/go-scaffold/SKILL.md.hbs`
- `tests/qa/http-contract.test.mjs` and `package.json` (`test:qa`)

No CLI flag, config key, route path, HTTP status code, or JSON field is
renamed. Existing generated projects keep their current code until they are
regenerated or adopt the helpers manually.

## Out of Scope

- A uniform `{data, meta}` envelope for every success response. That is a
  breaking wire change and needs its own cross-scaffold decision.
- A global `--json` output contract for the CLI. The CLI currently has JSON
  only for `generate module --plan` and `config show`; that is a separate
  layer from the generated HTTP API.
- Changing auth, MFA, refresh-token, or RBAC response fields.
- An automatic migration for generated projects that already exist.
