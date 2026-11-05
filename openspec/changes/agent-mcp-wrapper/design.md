# Design

## Context

The CLI already exposes the agent-facing primitives. This change adds a
transport, not a second implementation.

## Goals / Non-Goals

**Goals:**

- A stable MCP tool surface for the existing CLI operations.
- No interactive prompts; every tool is non-interactive.
- Structured JSON results and structured errors.
- The server can run from any workspace; it never escapes the launch root.

**Non-Goals:**

- New scaffolding behavior.
- HTTP/SSE transport.
- Tool-level authentication.
- Replacing the CLI's human wizards.

## Decisions

### 1. Thin subprocess wrapper

Each tool runs the real CLI binary with `child_process.spawn` and parses its
JSON output. This guarantees the MCP result and the CLI behavior cannot drift.
The server does not import command internals.

### 2. Stdio JSON-RPC

The server reads newline-delimited JSON-RPC 2.0 messages from stdin and writes
one JSON message per line to stdout. Diagnostics go to stderr. It handles:

- `initialize`
- `notifications/initialized` (no response)
- `tools/list`
- `tools/call`
- `ping` (optional)

Unknown methods return `-32601`; invalid params return `-32602`.

### 3. Tool surface

| Tool | Input | CLI |
| --- | --- | --- |
| `scaffold_interview` | `{presetDir?}` | `interview --json` |
| `scaffold_create_plan` | `{answers, presetDir?}` | `create --answers <tmp> --plan` |
| `scaffold_create_apply` | `{answers, presetDir?}` | `create --answers <tmp> --apply` |
| `scaffold_check` | `{}` | `check` in `root` |
| `scaffold_preset_list` | `{presetDir?}` | `preset list --json` |
| `scaffold_config_show` | `{}` | `config show` |

`answers` is the same object accepted by `create --answers`. The server writes
it to a temporary file, passes the path, and removes the file.

### 4. Root guard

The server resolves `root` against `process.cwd()`. A root outside the launch
directory is rejected with `OUTSIDE_ROOT`. Tool calls run with `cwd: root`.

### 5. Errors

- Transport errors: JSON-RPC error object.
- Tool failures: a successful JSON-RPC response with `isError: true` and a text
  content block containing the CLI stderr/stdout.
- The CLI exit code is preserved in the text; the MCP client decides whether to
  retry.

### 6. Tests

- Spawn the server with a temp workspace.
- Send `initialize`, `tools/list`, `tools/call` for `scaffold_interview`, a
  plan, a check, and an invalid method.
- Assert `create_plan` leaves the workspace empty.
- Assert a path outside the root is rejected.
