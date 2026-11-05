# Verification

Date: 2026-11-05

## Environment

- macOS arm64
- Go 1.26.5
- Node 26.12.1
- Docker 29.4.2; smoke test provisioned its own PostgreSQL container

## Base

`develop` at `e972974` (configurable HTTP contract merged).

## Commands and results

### Build

```text
$ pnpm run build
exit 0
```

### Full verify

```text
$ pnpm run verify
unit: 32 pass
integration: 130 pass
smoke: 58 checks pass (0 skipped)
QA: 9 pass
exit 0
```

The integration suite includes the new MCP server tests:

```text
✔ MCP server exposes the scaffolding tools and keeps plan read-only
✔ MCP server refuses a root outside its launch directory
```

### Manual MCP smoke

```text
initialize -> go-scaffold-mcp 2024-11-05
tools/list -> scaffold_interview, scaffold_create_plan, scaffold_create_apply,
             scaffold_check, scaffold_preset_list, scaffold_config_show
scaffold_interview -> schemaVersion 1 with the http.preset question
```

### OpenSpec

```text
$ openspec validate agent-mcp-wrapper --strict
Change 'agent-mcp-wrapper' is valid
exit 0
```
