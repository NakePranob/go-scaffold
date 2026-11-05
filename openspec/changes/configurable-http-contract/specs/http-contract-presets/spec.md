# Spec Delta

## ADDED Requirements

### Requirement: A closed shape catalog defines every supported response envelope

The CLI SHALL provide a closed catalog of response shapes for the `single`,
`list`, and `error` dimensions. Every shape SHALL have fixed field names and
an implemented template. A preset MUST NOT define a new shape, rename a field,
or compose arbitrary JSON paths.

#### Scenario: Supported single shapes

- **GIVEN** the shape catalog
- **WHEN** a preset selects `single: "bare"`
- **THEN** a successful single-resource response is the resource object
- **AND** when a preset selects `single: "data"`, the response is
  `{"data": <resource>}`

#### Scenario: Supported list shapes include pagination

- **GIVEN** a preset selects `list: "data-meta"`
- **WHEN** a client requests a collection
- **THEN** the response is
  `{"data": [...], "meta": {"limit": n, "offset": n, "total": n}}`
- **AND** a preset cannot combine `items-total` with a separate `meta` block

#### Scenario: Unsupported shape is rejected

- **GIVEN** a preset file with `list: "data-page"`
- **WHEN** `go-scaffold preset validate` runs
- **THEN** it fails with `UNKNOWN_SHAPE`
- **AND** the error lists the supported list shapes

### Requirement: A preset selects shape IDs only

A preset file SHALL contain a schema version, a unique name, an optional
description, and one shape ID for each dimension. The CLI MUST reject unknown
keys and MUST NOT execute preset content.

#### Scenario: Valid company preset

- **GIVEN** `presets/acme-v1.json` selects `data`, `data-meta`, and
  `error-object`
- **WHEN** the preset is validated
- **THEN** it is accepted
- **AND** its source path is reported by `preset list`

#### Scenario: Preset cannot carry a template

- **GIVEN** a preset file that contains a `template` field
- **WHEN** the preset is validated
- **THEN** it fails with `UNKNOWN_KEY`
- **AND** no project is created

### Requirement: The resolved contract is frozen in the project config

At create time the CLI SHALL resolve the selected preset into a `resolved`
block and persist it in `go-scaffold.config.json` with the preset name and a
hash. Later generation commands MUST read the resolved block, not the preset
file.

#### Scenario: Preset file changes after create

- **GIVEN** a project created with `acme-v1`
- **WHEN** `presets/acme-v1.json` changes on disk
- **THEN** `generate module` still uses the frozen `resolved` shapes
- **AND** `preset diff` reports the difference
- **AND** no file changes until `preset upgrade` is confirmed

#### Scenario: Default preset preserves the current wire format

- **GIVEN** a project created with the `default` preset
- **WHEN** the generated API serves a single resource, a list, a delete, and
  an error
- **THEN** the bodies match the pre-change wire format exactly

### Requirement: Generated writers match the resolved shapes

The generated `internal/shared/httpx` package and error middleware SHALL be
rendered from `http.resolved`. The function names and signatures SHALL remain
`OK`, `Created`, `NoContent`, and `Page`, and `apperror.Translate` SHALL remain
the error translator.

#### Scenario: Envelope preset writes a data wrapper

- **GIVEN** a project with `single: "data"` and `list: "data-meta"`
- **WHEN** a generated handler returns a resource and a collection
- **THEN** the single body is `{"data": <resource>}`
- **AND** the list body is `{"data": [...], "meta": {...}}`
- **AND** no handler calls `c.JSON` directly

#### Scenario: Error shape is generated once

- **GIVEN** a project with `error: "errors-array"`
- **WHEN** a handler returns a domain error
- **THEN** the middleware renders `{"errors": [{"code": "...", "message": "..."}]}`
- **AND** the same shape is used by module, auth, and RBAC handlers

### Requirement: The generated contract is documented once

A generated project SHALL include `docs/architect/http-contract.md` with the
selected shapes, status codes, error rules, and the custom-endpoint boundary.
The README, architecture notes, AGENTS file, and generated skill SHALL point
to that file instead of restating a different contract.

#### Scenario: Documentation matches the config

- **GIVEN** a project created with `acme-v1`
- **WHEN** a reader opens the HTTP contract document
- **THEN** it shows the same `single`, `list`, and `error` shapes as
  `http.resolved`
- **AND** the generated skill links to the document
