# Verification

Date: 2026-11-05

## Environment

- macOS arm64
- Go 1.26.5
- Node 26.12.1
- Docker 29.4.2; smoke test provisioned its own PostgreSQL container

## Base

Rebased on `develop` at `6ba0032` (the generic HTTP contract foundation).

## Commands and results

### Build

```text
$ pnpm run build
exit 0
```

### Unit

```text
$ pnpm run test:unit
tests 32, pass 32, fail 0
exit 0
```

### Integration

```text
$ pnpm run test:integration
tests 128, pass 128, fail 0
exit 0
```

Includes `create --answers --plan` / `--apply` and the schema-version migration
tests.

### Full verify

```text
$ pnpm run verify
build, unit, integration, smoke, and QA all passed
58 smoke checks, 9 QA tests
exit 0
```

### QA gate

```text
preset default writes the configured shapes: pass
preset envelope writes the configured shapes: pass
preset items writes the configured shapes: pass
preset problem writes the configured shapes: pass
generic HTTP contract regression tier: pass
generic HTTP contract target tier: pass
generic HTTP contract generated fixture: pass
```

The preset matrix creates a project for each built-in preset, writes Go oracle
tests for `httpx.OK/Created/NoContent/Page` and the error middleware, and runs
`go test` in the generated project.

### Company preset

A project created with `--http-preset acme-v1 --preset-dir ./presets` resolved
the company file and froze:

```json
{"single":"data","list":"items-total","error":"errors-array"}
```

`preset diff` reported a field-level change after editing the file.
`preset upgrade` without `--yes` refused; with `--yes` it updated the config
and left existing handlers untouched. `check` then reported the expected
contract mismatch in the generated `httpx` helper.

### Plan/apply

`create --answers answers.json --plan` reported `writes: false`, resolved the
envelope preset, and left the target directory absent. `--apply` created the
project with schema version 3 and the frozen `http` block.

### OpenSpec

```text
$ openspec validate configurable-http-contract --strict
Change 'configurable-http-contract' is valid
exit 0
```
