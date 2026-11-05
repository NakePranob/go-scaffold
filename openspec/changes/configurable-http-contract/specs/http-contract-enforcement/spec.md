# Spec Delta

## ADDED Requirements

### Requirement: Check enforces the contract on generated endpoints

`go-scaffold check` SHALL verify that every generated inbound adapter uses the
selected `httpx.*` helpers and that the generated error middleware matches
`http.resolved`. A generated adapter MUST NOT call `c.JSON` or `c.Status`
directly.

#### Scenario: Generated handler bypasses the helpers

- **GIVEN** a generated project with `single: "data"`
- **WHEN** a generated handler is edited to call `c.JSON(http.StatusOK, item)`
- **THEN** `go-scaffold check` fails
- **AND** the error names the file and the raw writer

#### Scenario: Error middleware uses the selected shape

- **GIVEN** a project with `error: "error-object"`
- **WHEN** a handler returns a domain error
- **THEN** the middleware renders the `error-object` envelope
- **AND** `check` confirms the middleware matches `http.resolved`

### Requirement: Custom endpoints are outside the contract in v1

`check` SHALL report custom, hand-written handlers as `outside contract` and
MUST NOT fail because of their payload shape. The generated contract applies
only to generated inbound adapters.

#### Scenario: Dashboard endpoint has a custom shape

- **GIVEN** a project with a hand-written dashboard handler returning
  `{"summary": ..., "charts": ...}`
- **WHEN** `go-scaffold check` runs
- **THEN** the project passes
- **AND** the dashboard handler is reported as `outside contract` (informational)

#### Scenario: Custom handler may use the helpers voluntarily

- **GIVEN** a custom handler that calls `httpx.OK`
- **WHEN** `check` runs
- **THEN** the handler is still outside the enforced set
- **AND** the helper keeps the selected envelope

### Requirement: Runtime QA proves every preset

The repository SHALL provide a QA test that generates a project for every
built-in preset and representative company presets, sends real HTTP requests,
and asserts the exact status and JSON keys. A skipped test MUST NOT count as
passed.

#### Scenario: Envelope preset over real HTTP

- **GIVEN** a generated project with `single: "data"` and `list: "data-meta"`
- **WHEN** the QA test requests a resource and a collection
- **THEN** it observes `{"data": ...}` and
  `{"data": [...], "meta": {"limit": ..., "offset": ..., "total": ...}}`
- **AND** the test runs `go test ./...`, `go vet ./...`, and
  `go-scaffold check`

#### Scenario: Default preset remains a regression gate

- **GIVEN** the current wire format before this change
- **WHEN** the QA test runs the `default` preset
- **THEN** the bodies match the pre-change shapes exactly
- **AND** the regression tier passes before and after the change
