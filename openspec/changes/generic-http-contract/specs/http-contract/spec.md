# Spec Delta

## Purpose

Defines one generic HTTP response writer and one generic domain-error
translator for generated Go projects while preserving the wire format that the
generated FSD clients already consume.

## ADDED Requirements

### Requirement: Success responses use one writer

Generated inbound HTTP adapters SHALL write every success response through
`internal/shared/httpx`. A generated adapter MUST NOT call `c.JSON(...)` or
`c.Status(...)` directly outside the shared `httpx` package.

#### Scenario: List response preserves the collection envelope

- **GIVEN** a generated module with a list endpoint
- **WHEN** a client requests the collection
- **THEN** the response is `200` with
  `{"data": [...], "limit": <n>, "offset": <n>, "total": <n>}`

#### Scenario: Single-resource response remains a bare object

- **GIVEN** a generated module with get, create, or update endpoints
- **WHEN** the request succeeds
- **THEN** the response is `200` (or `201` for create) with the resource
  object as the top-level body, not wrapped in `data`

#### Scenario: Empty success remains 204

- **GIVEN** a generated delete endpoint or a method that returns no body
- **WHEN** the operation succeeds
- **THEN** the response is `204` with an empty body

### Requirement: Domain errors use one translator

Generated applications SHALL translate domain errors through
`apperror.Translate` with an ordered list of `apperror.Rule` values declared in
the inbound adapter. The translator MUST pass an existing `*AppError` through
unchanged, match wrapped sentinels with `errors.Is`, and convert an unknown
error into a generic `500 INTERNAL` while preserving its cause for logging.

#### Scenario: Wrapped module sentinel becomes a module error code

- **GIVEN** a generated module rule mapping `domain.ErrNotFound` to
  `404 ORDER_NOT_FOUND`
- **WHEN** a repository returns an error wrapping `domain.ErrNotFound`
- **THEN** the client receives `404` with
  `{"error":{"code":"ORDER_NOT_FOUND","message":"order not found", ...}}`

#### Scenario: Unknown error does not leak internals

- **GIVEN** an error that matches no rule
- **WHEN** the handler renders it
- **THEN** the client receives `500`
  `{"error":{"code":"INTERNAL","message":"internal server error"}}`
  and the original cause remains available to the error middleware's log

#### Scenario: Existing AppError is not remapped

- **GIVEN** a handler receives an `*apperror.AppError` created by a lower
  layer
- **WHEN** it calls the module's `appError` wrapper
- **THEN** the same error value is returned and its status/code/message are
  unchanged

### Requirement: Auth and RBAC share the translator

Generated auth and RBAC inbound adapters SHALL use the same `appError`
function name and the same `apperror.Translate` mechanism as generated domain
modules. They MUST NOT define a separate `toHTTPError` switch.

#### Scenario: Auth rule error uses the shared error envelope

- **GIVEN** the generated auth module returns a `domain.RuleError` with a
  known code
- **WHEN** the handler renders it
- **THEN** the response uses the same `{"error":{"code":...}}` envelope and
  the same request ID field as every other module

#### Scenario: Auth and RBAC compile against the shared helpers

- **GIVEN** a project with `add auth` and `add rbac`
- **WHEN** the generated project runs `go test ./...`
- **THEN** the auth and RBAC packages compile and pass without a local
  `toHTTPError` helper

### Requirement: Generator emits the generic pattern

`generate module` and `generate method` SHALL emit handlers that use
`httpx.*` and the module's `appError` wrapper. `generate method` MUST NOT
depend on discovering an error-mapper function by name or regex.

#### Scenario: Generated method uses the shared writer

- **GIVEN** a generated CRUD module
- **WHEN** `generate method <module> <name> --type patch` runs
- **THEN** the new handler calls `appError(err)` on failure and
  `httpx.NoContent(c)` on success, and contains no raw `c.JSON` or `c.Status`

#### Scenario: Every module surface follows the same rule

- **GIVEN** modules generated with the minimal, read, CRUD, and none surfaces
- **WHEN** their inbound adapters are inspected
- **THEN** none contains a raw success writer, and every adapter with an
  error mapping uses `apperror.Translate`

### Requirement: Contract is documented once

Generated projects SHALL include `docs/architect/http-contract.md` describing
the success, collection, and error shapes and the rule that handlers do not
write JSON directly. The generated README, patterns, architecture, AGENTS, and
skill documents SHALL point to that file instead of restating partial
contracts.

#### Scenario: Generated documentation agrees on one contract

- **GIVEN** a newly generated project
- **WHEN** a reader opens the README, architecture notes, and the generated
  skill
- **THEN** each points to the same HTTP contract document and none claims a
  different envelope

### Requirement: QA gate is executable and blocking

The repository SHALL provide `pnpm run test:qa` that generates a temporary
project and runs both a regression tier and a target tier. The regression tier
MUST pass before and after the refactor. The target tier MUST fail before the
implementation and pass before this change is archived. The gate MUST NOT
count a skipped test as passed.

#### Scenario: Regression proves the current wire contract

- **GIVEN** the current implementation
- **WHEN** `pnpm run test:qa` runs its regression tier
- **THEN** real HTTP requests through a generated Gin router return the
  documented list, item, create, delete, 400, and 404 bodies

#### Scenario: Target tier blocks a code-only claim

- **GIVEN** the current implementation before the refactor
- **WHEN** `pnpm run test:qa` runs its target tier
- **THEN** it fails because `apperror.Translate`, `httpx.OK`, `httpx.Created`,
  `httpx.NoContent`, and `httpx.Page` do not exist, and because generated
  handlers still write JSON directly

#### Scenario: Full gate passes after the refactor

- **GIVEN** the refactored templates and helpers
- **WHEN** `pnpm run test:qa` runs
- **THEN** both tiers pass, `go test ./...` passes in the generated fixture,
  `go vet ./...` passes, and `go-scaffold check` passes
