# Tasks

## 1. QA gate first

- [x] 1.1 Write the OpenSpec proposal, design, spec delta, and QA plan for the
  generic HTTP contract; verify with
  `openspec validate generic-http-contract --strict`.
- [x] 1.2 Add `tests/qa/http-contract.test.mjs` and the `test:qa` package
  script. The harness generates a disposable project, writes Go oracle tests,
  and runs the regression and target tiers; verify with
  `pnpm run test:qa`.
- [x] 1.3 Run the baseline and record the exact output. The regression tier
  must pass; the target tier must fail for the expected missing symbols and
  source-pattern violations. Do not implement the refactor before this
  baseline is recorded.
- [x] 1.4 Confirm the QA harness is an external oracle: it writes its own Go
  tests into the generated fixture and does not rely on a test template owned
  by the implementation.

## 2. Generic helpers

- [x] 2.1 Add `apperror.Rule` and `apperror.Translate` to the base template;
  cover nil, `*AppError` passthrough, wrapped sentinel, first-rule precedence,
  unknown-error fallback, and cause preservation.
- [x] 2.2 Add `httpx.OK`, `httpx.Created`, `httpx.NoContent`, and `httpx.Page`
  to the base template; cover status, JSON body, content type, and the 204
  empty body.
- [x] 2.3 Keep `pagination.Response` and `ResponseWithTotal` wire-compatible;
  add a regression test for the exact `{data,limit,offset,total}` keys.

## 3. Generated templates

- [x] 3.1 Replace the generated module's `appError`/`applicationError` switch
  with an `httpErrors` rule table and a one-line `appError` wrapper; replace
  every `c.JSON`/`c.Status` in create/list/get/update/delete with `httpx.*`.
- [x] 3.2 Replace auth's `toHTTPError` switch with the shared `appError`
  pattern: a code→status table for `RuleError`, then `apperror.Translate` for
  sentinels; replace every auth success writer with `httpx.*`.
- [x] 3.3 Apply the same change to RBAC handlers and role/permission success
  writers.
- [x] 3.4 Update `generate method` to emit `httpx.*` and the module's
  `appError`. New projects use the canonical name; keep the legacy
  `applicationError` / `toHTTPError` fallback until those projects migrate.
- [x] 3.5 Add regression coverage for the generated module, auth, and RBAC
  handler tests; keep the existing route-registration tests.

## 4. Contract documentation

- [x] 4.1 Add `docs/architect/http-contract.md` to generated projects with the
  success, collection, error, request-ID, and production-details rules.
- [x] 4.2 Update the generated README, `patterns.md`, `architecture.md`,
  `AGENTS.md`, and the generated skill to point to the single contract file.
- [x] 4.3 Update `CHANGELOG.md` and `REFERENCE.md` with the new helper names
  and the fact that the wire format did not change.
- [x] 4.4 Create `before-after.html` as the visual comparison artifact and
  verify it in ego-browser at desktop and 600px widths with no horizontal page
  overflow; keep the full-page and top screenshots next to it.

## 5. Verification

- [x] 5.1 `pnpm run build` exits 0.
- [x] 5.2 `pnpm run test:qa` exits 0 with both tiers green and no skips.
- [x] 5.3 `pnpm run test` (unit, integration, smoke) exits 0. With Docker running: 32 unit, 123 integration, 58 smoke checks passed.
- [x] 5.4 Generate fresh minimal, read, CRUD, CQRS, and none modules plus auth
  and RBAC; run `go test ./...`, `go vet ./...`, and `go-scaffold check` in each
  generated fixture.
- [x] 5.5 `openspec validate generic-http-contract --strict` exits 0.
- [x] 5.6 Record the exact commands, exit codes, and summary output in the
  change's verification note before marking this change ready for review.
- [x] 5.7 Once the target tier is green, add `pnpm run test:qa` to the
  `verify` script so `prepublishOnly` cannot skip this gate.

## Workflow follow-up

- Archive the OpenSpec change only after the final review and a green QA gate.
- If the user later chooses a uniform `{data, meta}` envelope or a CLI `--json`
  contract, create separate changes; do not fold them into this one.
