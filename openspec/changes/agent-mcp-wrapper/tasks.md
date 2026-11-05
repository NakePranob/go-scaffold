# Tasks

## 1. MCP transport

- [x] 1.1 Add `src/mcp/server.ts` with newline-delimited JSON-RPC over stdio.
- [x] 1.2 Handle `initialize`, `notifications/initialized`, `tools/list`,
  `tools/call`, and `ping`; return `-32601` for unknown methods.
- [x] 1.3 Log only to stderr; stdout is reserved for JSON-RPC responses.
- [x] 1.4 Add the `mcp` command in `src/index.ts` with a `--root <dir>` option.

## 2. Tools

- [x] 2.1 `scaffold_interview` runs `interview --json`.
- [x] 2.2 `scaffold_create_plan` writes the answers to a temp file, runs
  `create --answers <tmp> --plan`, returns the parsed plan, and removes the
  temp file.
- [x] 2.3 `scaffold_create_apply` runs `create --answers <tmp> --apply`.
- [x] 2.4 `scaffold_check` runs `check` in the root.
- [x] 2.5 `scaffold_preset_list` runs `preset list --json`.
- [x] 2.6 `scaffold_config_show` runs `config show`.
- [x] 2.7 Return CLI failures as `isError: true` with the observed output.

## 3. Safety

- [x] 3.1 Resolve `root` against the launch directory and reject paths outside
  it with `OUTSIDE_ROOT`.
- [x] 3.2 Never prompt; all tool calls are non-interactive.
- [x] 3.3 Remove temporary answer files on success and failure.

## 4. Documentation

- [x] 4.1 Add an `mcp` section to `REFERENCE.md` with the tool list and a
  client configuration example.
- [x] 4.2 Add a `CHANGELOG.md` entry.

## 5. Verification

- [x] 5.1 Add an integration test that spawns the server and exercises
  `initialize`, `tools/list`, `scaffold_interview`, `scaffold_create_plan`,
  `scaffold_check`, and an unknown method.
- [x] 5.2 Assert `scaffold_create_plan` leaves the root empty.
- [x] 5.3 Assert a root outside the launch directory is rejected.
- [x] 5.4 `pnpm run build` exits 0.
- [x] 5.5 `pnpm run test` exits 0.
- [x] 5.6 `pnpm run test:qa` exits 0.
- [x] 5.7 `openspec validate agent-mcp-wrapper --strict` exits 0.
