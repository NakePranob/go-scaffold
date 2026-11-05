# Proposal

## Why

The CLI now has a machine-readable creation flow (`interview --json`,
`create --answers ... --plan/--apply`) and preset commands. An agent can drive
it through a shell, but it still has to discover the CLI, construct commands,
capture stdout, and parse text errors. MCP gives agents a typed tool surface:
the client discovers `scaffold_interview`, `scaffold_create_plan`,
`scaffold_create_apply`, and `scaffold_check` with JSON schemas instead of
guessing CLI flags.

The wrapper must stay thin. It must not reimplement the interview, plan,
apply, preset, or check logic; the CLI remains the source of truth and the
enforcement point.

## What Changes

- Add `go-scaffold mcp`, a stdio MCP server.
- Expose tools:
  - `scaffold_interview` — the current `interview --json` payload.
  - `scaffold_create_plan` — `create --answers ... --plan`, no writes.
  - `scaffold_create_apply` — `create --answers ... --apply`.
  - `scaffold_check` — run `check` in a project.
  - `scaffold_preset_list` — list built-in and company presets.
  - `scaffold_config_show` — read the resolved project config.
- Use JSON-RPC 2.0 over stdin/stdout with newline-delimited messages. No HTTP
  transport in this change.
- Restrict `root` to the server's launch directory or a child of it.

## Capabilities

### New Capabilities

- `agent-mcp-server`: the stdio transport, tool discovery, tool calls, and
  structured errors.

### Modified Capabilities

- None.

## Impact

- `src/mcp/server.ts` and `src/mcp/tools.ts` (new).
- `src/index.ts` (`mcp` command).
- `package.json` (`bin` or script only; no new runtime dependency).
- `tests/integration/mcp-server.test.mjs` (new).
- `REFERENCE.md`, `CHANGELOG.md`.

## Out of Scope

- Reimplementing CLI logic in the MCP server.
- HTTP/SSE MCP transport or a hosted service.
- Authentication and multi-user authorization for the MCP server.
- A remote preset registry.
- Changing the existing CLI commands or their output.
