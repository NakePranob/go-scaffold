# QA Plan

## Purpose

This gate proves the configurable HTTP contract at the wire level. It does not
trust the implementation's own tests: the harness generates a disposable
project, writes its own Go oracle tests into the fixture, starts a real Gin
router, and asserts the exact status and JSON keys.

The default preset is the regression tier. It must match the current wire
format before and after the change. Every other supported preset is the target
tier: it does not exist before the change and must be green after it.

## Harness

- New file: `tests/qa/http-contract-presets.test.mjs`.
- New package script: `test:qa:presets` or an extension of `test:qa`.
- Each case creates a temporary directory, runs `create --answers ... --apply`
  with a fixed answers file, and keeps the fixture only when `QA_KEEP=1`.
- The harness writes Go tests into the fixture. It never imports a test helper
  from the template under test.
- Every case runs:
  - `go test ./...`
  - `go vet ./...`
  - `go-scaffold check --json`

## Matrix

| Case | single | list | error | Purpose |
| --- | --- | --- | --- | --- |
| `default` | `bare` | `data-limit-offset-total` | `error-object` | Regression: current wire format |
| `envelope` | `data` | `data-meta` | `error-object` | Common company envelope |
| `items` | `data` | `items-total` | `errors-array` | Common company list and error style |
| `problem` | `bare` | `data-limit-offset-total` | `problem-json` | RFC 7807 error shape |
| `company-acme` | `data` | `data-meta` | `error-object` | Company preset file |
| `company-bee` | `data` | `items-total` | `errors-array` | Second company preset file |

At least one case must use `--preset-dir` with a preset file outside the
project directory.

## HTTP assertions per case

For every generated module in the fixture:

1. `GET /<plural>` returns the selected list shape with the exact keys.
2. `GET /<plural>/:id` returns the selected single shape.
3. `POST /<plural>` returns `201` with the selected single shape.
4. `PATCH /<plural>/:id` returns the selected single shape.
5. `DELETE /<plural>/:id` returns `204` with an empty body.
6. A validation failure returns `400` with the selected error shape.
7. A missing record returns `404` with the selected error shape.
8. The error response includes `request_id` when the selected shape supports
   it.
9. No response contains an unexpected wrapper key.
10. `Content-Type` is `application/json` for JSON bodies and absent for `204`.

## No-write and validation checks

- `create --answers ... --plan` exits 0, reports `writes: 0`, and leaves the
  target directory absent or empty.
- `create --answers ... --apply` creates exactly the file list returned by the
  plan.
- `preset validate` rejects:
  - an unknown shape ID;
  - an unknown key;
  - a malformed JSON file;
  - a duplicate preset name.
- `preset list` returns built-in and company presets with sources.
- `preset diff` reports a field-level change after editing the preset file.
- `preset upgrade` without confirmation leaves the config unchanged.
- A missing preset returns `PRESET_NOT_FOUND` and lists the searched paths.

## Migration checks

- A schema version 2 project without `http` loads with the `default` preset.
- Reading the project does not rewrite the wire format.
- The next config write persists `schemaVersion: 3` and the frozen
  `http.resolved` block.
- The generated `docs/architect/http-contract.md` matches the persisted
  `resolved` shapes.

## Frontend warning check

- `create --plan` with a non-default preset and a generated Next.js or
  SvelteKit client emits a warning that the FSD client assumes the default
  shapes.
- The plan still succeeds; the warning is explicit.

## Pass criteria

- All matrix cases pass.
- The `default` regression tier passes before and after the change.
- No skipped test is counted as passed.
- `pnpm run build`, `pnpm run test`, and `pnpm run test:qa` exit 0.
- `openspec validate configurable-http-contract --strict` exits 0.
