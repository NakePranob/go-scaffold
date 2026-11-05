# QA Plan

This plan is the acceptance gate for `generic-http-contract`. It exists to
prove behaviour, not to justify a code change after the fact. The gate is
expected to be **red before the refactor** and **green after it**; a run that
claims success without the commands below is not evidence.

## Scope and assumptions

- The target is the non-breaking approach: keep the current wire shapes,
  centralize the writer and error translator.
- The CLI `--json` contract and a uniform `{data, meta}` envelope are out of
  scope. They are separate decisions.
- The gate does not require Docker, Postgres, or Redis. The route-level tests
  use a real Gin router served by `httptest.NewServer` and a stub application
  port, so they exercise HTTP JSON behaviour without a database.
- The generated project is a disposable fixture under the OS temp directory.
  `QA_KEEP=1` keeps it for inspection; otherwise it is deleted.

## Environment

| Tool | Version used for the baseline |
| --- | --- |
| Go | 1.26.5 |
| Node.js | 26.7.0 |
| pnpm | 11.0.7 |

## Commands

```bash
cd projects/go-scaffold-read-surface
pnpm run build
pnpm run test:qa
```

`test:qa` runs `node --test tests/qa/http-contract.test.mjs`. To retain the
generated fixture for debugging:

```bash
QA_KEEP=1 pnpm run test:qa
```

## Test matrix

### Regression tier — must pass before and after the refactor

These tests capture the current wire contract. They are the proof that the
refactor does not silently change what clients already consume.

| ID | Check | Oracle |
| --- | --- | --- |
| QA-HTTP-01 | List returns `200` with `{data, limit, offset, total}` | Generated `orders` handler, stub list returns an empty page |
| QA-HTTP-02 | Get returns `200` with a bare resource object | Generated `orders` handler, stub returns an order |
| QA-HTTP-03 | Create returns `201` with a bare resource object | Generated `orders` handler, stub create succeeds |
| QA-HTTP-04 | Delete returns `204` with an empty body | Generated `orders` handler, stub delete succeeds |
| QA-HTTP-05 | Missing resource returns `404` with `{error:{code,message,request_id}}` | Stub get returns `domain.ErrNotFound` |
| QA-HTTP-06 | Invalid route ID returns `400` with `VALIDATION_ERROR` | `GET /orders/not-a-uuid` |
| QA-HTTP-07 | Error middleware preserves the request ID | `middleware.RequestID` + `middleware.Error(false)` |
| QA-HTTP-08 | Pagination helper keeps the collection envelope | `pagination.Params.ResponseWithTotal` |
| QA-HTTP-09 | The same contract works over a real HTTP listener | `httptest.NewServer` + `http.Get` for list and invalid-ID error |

### Target tier — expected red before the refactor, must be green after

| ID | Check | Oracle |
| --- | --- | --- |
| QA-HTTP-10 | `apperror.Rule` and `apperror.Translate` exist and behave | Go table test in the generated project's `apperror` package |
| QA-HTTP-11 | `httpx.OK`, `Created`, `NoContent`, `Page` exist and behave | Go test in the generated project's `httpx` package |
| QA-HTTP-12 | Generated module handlers use `httpx.*` and `apperror.Translate` | Generated `orders`, `catalog`, `relay`, `presence` source inspection |
| QA-HTTP-13 | Auth and RBAC handlers use the same translator and have no `toHTTPError` | Generated auth/RBAC source inspection |
| QA-HTTP-14 | Generated method uses `httpx.NoContent` and `appError`, not raw writers | Generated `orders` `method_approve.go` |
| QA-HTTP-15 | The generated fixture compiles and passes its own checks | `go test ./...`, `go vet ./...`, `go-scaffold check` |

## Fixture

The harness generates one project and these surfaces:

```text
qaapp
  orders    --profile crud --defaults
  catalog   --surface read --defaults
  relay     --surface none --defaults
  presence  --surface minimal --cqrs --defaults
  orders    + generate method approve --type patch
  add auth --defaults --yes
  add rbac --yes
```

The harness writes the Go oracle tests into the generated project at test
time. It does not rely on a test template shipped by the implementation, so a
template cannot pass by weakening its own assertions.

## Exit criteria

The change is not accepted until all of the following are true and the exact
output is recorded:

1. `pnpm run build` exits 0.
2. `pnpm run test:qa` exits 0.
3. The output shows the regression tier passing and the target tier passing;
   no check is reported as skipped.
4. The generated fixture's `go test ./...` exits 0.
5. The generated fixture's `go vet ./...` exits 0.
6. `go-scaffold check` in the generated fixture prints
   `architecture check passed`.
7. `openspec validate generic-http-contract --strict` exits 0.

## Wiring into release verification

`pnpm run test:qa` is intentionally a separate script while the target tier is
red. Once the target tier is green, it MUST be added to the `verify` script so
`prepublishOnly` cannot publish a package that skips this gate. Until then, the
implementation is not considered complete.

## Baseline evidence (before the refactor)

Run date: 2026-11-05. Environment: Go 1.26.5, Node.js 26.7.0, pnpm 11.0.7.

Commands and results:

```text
$ pnpm run build
build: passed

$ pnpm run test:qa
▶ generic HTTP contract
  ✔ regression tier: current wire shapes are stable (1110.470083ms)
  ✖ target tier: generic helpers exist and behave (144.131667ms)
  ✖ target tier: generated handlers use one response/error pattern (0.636875ms)
  ✖ target tier: generated fixture compiles and passes its checks (3351.759959ms)
ℹ tests 5
ℹ pass 1
ℹ fail 4
ℹ skipped 0
```

The regression tier passed. It sent real HTTP requests through the generated
Gin router, including `httptest.NewServer`, and asserted the list, item,
create, delete, 404, 400, request-ID, and pagination bodies.

Verbose evidence from the kept fixture:

```text
=== RUN   TestHTTPJSONContract
--- PASS: TestHTTPJSONContract/list_uses_data_limit_offset_total
--- PASS: TestHTTPJSONContract/item_response_is_the_resource_object
--- PASS: TestHTTPJSONContract/not_found_uses_the_error_envelope_with_a_module_code
--- PASS: TestHTTPJSONContract/invalid_id_uses_VALIDATION_ERROR
--- PASS: TestHTTPJSONContract/create_returns_201_and_the_resource_object
--- PASS: TestHTTPJSONContract/delete_returns_204_with_no_body
--- PASS: TestHTTPJSONContractOverNetwork
PASS
ok  qaapp/internal/app/order/adapters/inbound/http
```

The target tier failed for the expected reasons:

```text
internal/shared/apperror/translate_qa_test.go:13:13: undefined: Rule
internal/shared/apperror/translate_qa_test.go:17:12: undefined: Translate
internal/shared/httpx/respond_qa_test.go:33:2: undefined: OK
internal/shared/httpx/respond_qa_test.go:42:2: undefined: Created
internal/shared/httpx/respond_qa_test.go:48:2: undefined: NoContent
internal/shared/httpx/respond_qa_test.go:54:2: undefined: Page

AssertionError: .../internal/app/order/adapters/inbound/http/handler.go
still writes JSON with c.JSON(...)
```

The generated fixture's `go test ./...` passed every package except
`internal/shared/apperror` and `internal/shared/httpx`, which failed to build
because the QA oracle tests require the new helpers. This is the expected red
baseline: the current wire contract is green, and the generic mechanism does
not exist yet.

Manual checks in the kept fixture:

```text
$ go vet ./...
vet: internal/shared/apperror/translate_qa_test.go:13:13: undefined: Rule
vet: internal/shared/httpx/respond_qa_test.go:33:2: undefined: OK
exit 1

$ go-scaffold check
architecture check passed: 6 split module(s), hexagonal boundary
exit 0
```

OpenSpec validation:

```text
$ openspec validate generic-http-contract --strict
Change 'generic-http-contract' is valid
```

## Why this is stronger than a source-only check

- The regression tier sends real HTTP requests and parses the response bodies;
  it would fail if the refactor changed a status code, a JSON key, or the error
  envelope.
- The target tier compiles Go tests against the new symbols; a missing or
  wrongly typed helper is a build failure, not a code-review opinion.
- The static tier checks every generated surface, including auth and RBAC,
  because those were the places where the old pattern diverged.
- The generated-project health tier runs the generated tests and the
  architecture check, so the templates must produce a project that builds and
  passes its own conventions.

## Known limitations

- The route tests use a stub application port, not a real Postgres-backed
  repository. They prove the HTTP contract, not SQL or migration behaviour.
- The gate does not run the CLI's full smoke suite. `pnpm run test` remains the
  broader regression suite and must also pass before release.
- Auth and RBAC are covered statically plus by the generated project's
  `go test ./...`; there is no route-level auth fixture in this gate because
  the auth flow needs more setup than this contract change justifies.
