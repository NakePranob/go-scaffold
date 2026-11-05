# Verification

Date: 2026-11-05

## Environment

- macOS arm64
- Go 1.26.5
- Node 26.12.1
- Docker 29.4.2 available; the smoke test provisioned its own PostgreSQL
  container. Local `psql` is absent, so the smoke test uses `docker exec`.

## Commands and results

### Build

```text
$ pnpm run build
exit 0
```

### QA gate

```text
$ pnpm run test:qa
▶ generic HTTP contract
  ✔ regression tier: current wire shapes are stable
  ✔ target tier: generic helpers exist and behave
  ✔ target tier: generated handlers use one response/error pattern
  ✔ target tier: generated fixture compiles and passes its checks
✔ generic HTTP contract
tests 5, pass 5, fail 0
exit 0
```

The QA fixture generates a CRUD module, a read module, a none module, a
minimal CQRS module, an auth feature, RBAC, and a patched method. It then runs
the regression and target Go tests, `go test ./...`, `go vet ./...`, and
`go-scaffold check` in the generated project.

### Unit

```text
$ pnpm run test:unit
tests 32, pass 32, fail 0
exit 0
```

### Integration

```text
$ pnpm run test:integration
tests 123, pass 123, fail 0
exit 0
```

### Smoke

```text
$ pnpm run test:smoke
58 checks passed
0 skipped
exit 0
```

This includes the DB/Docker-backed auth, RBAC, worker, migration, and
observability runs, plus the generated-project build, vet, gofmt, tests,
generate-method patches, none surface, OpenAPI bundle, and lint.

### Full suite

```text
$ pnpm run test
tests 32 unit, 123 integration, 58 smoke checks
exit 0
```

### Verify gate

```text
$ pnpm run verify
build, unit, integration, smoke, and QA all passed
58 smoke checks, 5 QA tests
exit 0
```

### OpenSpec

```text
$ openspec validate generic-http-contract --strict
Change 'generic-http-contract' is valid
exit 0
```

## Wire-format regression

The QA regression tier passed before and after the refactor. It asserts:

- list: `{data, limit, offset, total}`
- single resource: bare object
- create: `201` with the resource object
- delete: `204` with an empty body
- error: `{"error": {code, message, request_id}}`
- validation error: `400 VALIDATION_ERROR`

## Environment note

Docker was started before the final smoke/full-suite run. The smoke test
created and removed its own PostgreSQL container; no local `psql` install was
required.
