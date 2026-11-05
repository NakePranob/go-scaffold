# Spec Delta

## ADDED Requirements

### Requirement: The MCP server exposes the CLI as typed tools

The CLI SHALL provide `go-scaffold mcp`, a stdio MCP server. It SHALL expose
`scaffold_interview`, `scaffold_create_plan`, `scaffold_create_apply`,
`scaffold_check`, `scaffold_preset_list`, and `scaffold_config_show` with JSON
input schemas. Each tool MUST run the corresponding CLI command and MUST NOT
reimplement its logic.

#### Scenario: Tool discovery

- **GIVEN** an MCP client connected to `go-scaffold mcp`
- **WHEN** the client sends `tools/list`
- **THEN** the response lists the six tools with input schemas
- **AND** no tool has an interactive prompt

#### Scenario: Interview tool

- **GIVEN** a client that calls `scaffold_interview`
- **WHEN** the server runs `interview --json`
- **THEN** the tool result is the parsed interview schema
- **AND** the workspace is unchanged

### Requirement: Plan writes nothing and apply writes the plan

`scaffold_create_plan` SHALL resolve the preset and return the plan with
`writes: false`. `scaffold_create_apply` SHALL create the project. The server
MUST write the answers to a temporary file and remove it after the call.

#### Scenario: Plan leaves the workspace empty

- **GIVEN** an empty root and a valid answers object
- **WHEN** the client calls `scaffold_create_plan`
- **THEN** the result contains `writes: false` and `http.resolved`
- **AND** the project directory does not exist

#### Scenario: Apply creates the project

- **GIVEN** the same answers
- **WHEN** the client calls `scaffold_create_apply`
- **THEN** the project config contains the frozen `http` block
- **AND** the temporary answers file is gone

### Requirement: Tool failures are structured

A CLI failure SHALL return an MCP tool result with `isError: true` and the
observed stdout/stderr. Unknown JSON-RPC methods SHALL return `-32601`.

#### Scenario: Invalid preset

- **GIVEN** answers that select a missing preset
- **WHEN** the client calls `scaffold_create_plan`
- **THEN** the tool result has `isError: true`
- **AND** the text names the missing preset and searched paths

#### Scenario: Unknown method

- **GIVEN** a JSON-RPC request with an unknown method
- **WHEN** the server handles it
- **THEN** the response is an error with code `-32601`

### Requirement: The server cannot escape its launch root

The server SHALL resolve `root` against its launch directory. A path outside
that directory MUST be rejected with `OUTSIDE_ROOT`.

#### Scenario: Parent directory is rejected

- **GIVEN** a root of `..`
- **WHEN** a tool is called
- **THEN** the tool result is `isError: true`
- **AND** the error code is `OUTSIDE_ROOT`
