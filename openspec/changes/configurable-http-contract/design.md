# Design

## Context

See `proposal.md` for motivation. The generated API already has one place that
renders errors (`middleware.Error`) and, after `generic-http-contract`, one
place that writes success responses (`internal/shared/httpx`). This change
turns those fixed helpers into a small, generated contract selected at project
creation.

The contract covers the **response envelope**, not the whole payload. Field
names inside a resource, request bodies, and domain DTOs remain the agent's
domain design. The CLI owns only the shapes it can generate and check.

## Goals / Non-Goals

**Goals:**

- Express the common company REST standards without letting the agent write
  templates.
- Keep one closed catalog of shapes so `check` and runtime tests can verify
  every option.
- Let an agent interview the user before writing, with the CLI as the source
  of truth for the questions and options.
- Freeze the resolved shapes in the project config so a later preset change
  cannot silently alter an existing project.
- Keep the current wire format as the default so existing projects do not
  change.

**Non-Goals:**

- A general JSON mapping engine or arbitrary envelope AST.
- Per-endpoint or per-module overrides.
- Configurable request payloads, DTO fields, or domain models.
- Configurable status codes or error-code naming.
- Auth/MFA/token success shapes.
- A remote preset registry.
- Enforcing custom endpoints in v1.

## Decisions

### 1. A closed shape catalog with fixed field names

A shape is a named, implemented response layout. Every field name in a shape
is fixed. A preset selects one shape per dimension; it cannot rename fields or
combine arbitrary paths.

Initial catalog:

| Dimension | Shape ID | Body |
| --- | --- | --- |
| single | `bare` | the resource object |
| single | `data` | `{"data": <resource>}` |
| list | `data-limit-offset-total` | `{"data": [...], "limit": n, "offset": n, "total": n}` |
| list | `data-meta` | `{"data": [...], "meta": {"limit": n, "offset": n, "total": n}}` |
| list | `items-total` | `{"items": [...], "total": n}` |
| error | `error-object` | `{"error": {"code": "...", "message": "...", "details"?: ..., "request_id"?: "..."}}` |
| error | `errors-array` | `{"errors": [{"code": "...", "message": "..."}]}` |
| error | `problem-json` | `{"type": "...", "title": "...", "status": n, "detail": "...", "instance": "..."}` |

A list shape includes its pagination layout. That avoids invalid
combinations such as `items-total` plus a `meta` object. Adding a shape is a
CLI change: a new template, a new `check` rule, and tests. The agent may
propose a shape, but it cannot add one to the catalog at runtime.

### 2. A preset is data, not code

A preset file is a small JSON document:

```json
{
  "schemaVersion": 1,
  "name": "acme-v1",
  "description": "ACME API response standard",
  "http": {
    "single": "data",
    "list": "data-meta",
    "error": "error-object"
  }
}
```

The file may live in `presets/` in the workspace, in a shared company
repository passed by `--preset-dir`, or in a default search directory. The CLI
validates the schema, every shape ID, the preset name, and unknown keys. It
does not execute preset content.

Built-in presets:

- `default`: `bare` + `data-limit-offset-total` + `error-object`. This is the
  current wire format.
- `envelope`: `data` + `data-meta` + `error-object`.
- `items`: `data` + `items-total` + `errors-array`.

A company preset is a named combination of the same catalog. It cannot add a
shape or rename a field.

### 3. Resolve and freeze the contract at create time

`go-scaffold.config.json` gains an `http` section (schema version 3):

```json
{
  "schemaVersion": 3,
  "http": {
    "preset": "acme-v1",
    "resolved": {
      "single": "data",
      "list": "data-meta",
      "error": "error-object"
    },
    "presetHash": "sha256:..."
  }
}
```

`resolved` is the contract. Later `generate module` and `generate method`
commands read it and do not need the preset file. The preset file is an input
to creation, not a runtime dependency.

If `http` is missing in an existing schema version 2 project, the loader fills
the `default` preset and leaves the wire format unchanged. A later write
persists the block. The migration does not rewrite handlers.

`preset upgrade` changes the config for future generation. It does not rewrite
existing handlers. The generated `docs/architect/http-contract.md` and the
project skill must state this limitation.

### 4. The CLI owns the interview; the agent owns the conversation

`go-scaffold interview --json` returns the standard questions, not a prose
wizard. A minimal response:

```json
{
  "schemaVersion": 1,
  "cliVersion": "0.17.0",
  "questions": [
    {
      "id": "project.name",
      "type": "text",
      "question": "Project name",
      "default": "my-service",
      "required": true
    },
    {
      "id": "http.preset",
      "type": "select",
      "question": "HTTP response contract",
      "options": [
        {
          "value": "default",
          "label": "go-scaffold default",
          "description": "bare single, data/limit/offset/total list, error object",
          "recommended": true,
          "why": "Keeps the current wire format and the generated FSD clients compatible."
        },
        {
          "value": "acme-v1",
          "label": "ACME standard",
          "description": "data success, data/meta list, error object",
          "source": "presets/acme-v1.json"
        }
      ],
      "default": "default"
    }
  ]
}
```

The agent asks one question at a time in the user's language. If the user does
not know, the agent uses `recommended` and explains `why`. The agent may add
domain questions of its own, but it must not invent HTTP options: every option
that affects the generated contract must come from the CLI schema.

`create --answers <file> --plan` validates the answers, resolves the preset,
and returns an `http.resolved` block plus file counts and warnings. It writes
nothing. `--apply` performs the writes. Plan and apply are mutually exclusive.
The interactive wizard remains for human users.

### 5. Generated writers come from the resolved shapes

`internal/shared/httpx` keeps the same function names and signatures from
`generic-http-contract`, but the template body is selected by the resolved
shapes:

```go
func OK(c *gin.Context, data any) {
    c.JSON(http.StatusOK, gin.H{"data": data})
}

func Page(c *gin.Context, p pagination.Params, data any, total int64) {
    c.JSON(http.StatusOK, gin.H{
        "data": data,
        "meta": gin.H{"limit": p.Limit, "offset": p.Offset, "total": total},
    })
}
```

`Created` and `NoContent` follow the same rule. The error middleware renders
the selected error shape. Domain code stays free of `net/http` and Gin; the
inbound adapter owns the mapping.

### 6. Enforcement stops at the generated surface

`check` enforces the contract on generated inbound adapters:

- every success path uses `httpx.*`;
- no raw `c.JSON` or `c.Status` in a generated adapter;
- the helper bodies and error middleware match `http.resolved`;
- `generate method` emits the same helpers.

Custom handlers are outside the contract. `check` reports them as
informational and does not fail. This keeps dashboards, reports, and
aggregations free to use their own payloads. A future opt-in annotation
(`//go-scaffold:contract <preset>`) can bring a custom handler into the
contract; it is not part of this change.

### 7. The skill ships with the CLI

The CLI package contains the bootstrap skill. `go-scaffold skill install`
writes it for the current agent, and `go-scaffold skill print --json` returns
it for agents that cannot write skill files. The bootstrap skill says:

1. Run `go-scaffold interview --json`.
2. Ask the user each question in their language.
3. Use the recommended option only when the user does not know.
4. Write the answers; run `create --answers ... --plan`.
5. Show the resolved shapes and file counts; wait for confirmation.
6. Run `--apply`, then `check`.

The generated project skill is separate. It reads the frozen `http.resolved`
block, points at `docs/architect/http-contract.md`, and tells the agent how to
extend generated modules without bypassing `httpx` or `apperror.Translate`.
Both skills are versioned with the CLI; the skill must not contain a second
copy of the question list.

### 8. QA is parametric, not one golden path

`tests/qa/http-contract-presets.test.mjs` generates a project for every
built-in preset and for representative company presets. For each one it:

- starts a real Gin router and sends list, get, create, update, delete, 400,
  and 404 requests;
- asserts the exact status, JSON keys, and absent keys;
- runs `go test ./...`, `go vet ./...`, and `go-scaffold check`;
- asserts `create --plan` wrote nothing and `--apply` wrote the plan;
- asserts `preset validate` rejects an unknown shape, an unknown key, and a
  duplicate name.

The default preset is the regression tier: it must match today's wire format
before and after the change. The other presets are the target tier: they do
not exist before the change and must be green after it.

## Data Model

`go-scaffold.config.json` (schema version 3):

```json
{
  "schemaVersion": 3,
  "projectName": "acme-shop",
  "goModule": "github.com/acme/shop",
  "apiPrefix": "v1",
  "features": {
    "docker": true,
    "openapiDocs": true,
    "auth": true,
    "rbac": true
  },
  "architecture": {
    "style": "modular-monolith",
    "boundary": "hexagonal",
    "packageLayout": "split",
    "defaultModuleSurface": "crud",
    "defaultApplicationStyle": "service"
  },
  "http": {
    "preset": "acme-v1",
    "resolved": {
      "single": "data",
      "list": "data-meta",
      "error": "error-object"
    },
    "presetHash": "sha256:..."
  },
  "modules": {}
}
```

The `resolved` block is the authoritative contract. `preset` and
`presetHash` are provenance.

## Migration Plan

- `generic-http-contract` lands first and keeps the current wire format.
- This change adds schema version 3. Existing version 2 projects load with the
  `default` preset and keep their current behavior.
- New projects select a preset at create time. The default remains the current
  wire format.
- `preset upgrade` updates `preset`, `resolved`, and `presetHash` for future
  generation. It prints the list of existing generated files that still use
  the old shapes and requires explicit confirmation.
- Rollback: restore the previous config block and regenerate. The generated
  wire format is data, so no database migration is involved.

## Risks / Trade-offs

- **Catalog explosion.** Every shape adds templates, checks, and QA cases.
  Keep the catalog small and add a shape only when a real standard needs it.
- **Preset upgrade can surprise a team.** Freezing `resolved` prevents silent
  changes, but it also means an old project does not follow a new company
  standard automatically. `preset diff` and `preset upgrade` make that
  explicit.
- **`check` can be too strict.** The rule applies only to generated adapters.
  Custom handlers are informational. False positives in generated code are
  still possible; the QA oracle is the source of truth.
- **Agent drift.** If the bootstrap skill hardcodes questions, it will
  disagree with the CLI. The skill must read `interview --json`; the CLI
  schema is the only source of truth.
- **Frontend compatibility.** The generated Next.js and SvelteKit FSD clients
  assume the default shapes. A non-default preset changes the API contract.
  Until those generators support the same preset, `create --plan` must warn
  when a non-default preset is combined with a generated FSD client. This is a
  separate cross-scaffold change, not silently shipped here.
- **Auth/MFA special cases.** Their success shapes stay fixed in v1. Their
  errors use the selected error shape. A company that needs a different auth
  success envelope needs a separate change.

## Resolved for this change

- **Preset upgrade is config-only.** It updates `preset`, `resolved`, and
  `presetHash` for future generation and lists existing handlers that still
  use the old shapes. It does not rewrite them.
- **The opt-in annotation is deferred.** v1 enforces generated endpoints only;
  custom handlers stay outside the contract. The annotation can be a later
  change.
- **Preset search paths are `./presets` and
  `~/.config/go-scaffold/presets`, plus an explicit `--preset-dir`.** A remote
  registry is out of scope.
- **The frontend FSD clients remain on the default shapes in this change.**
  `create --plan` warns when a non-default preset is combined with a generated
  Next.js or SvelteKit client. A separate cross-scaffold change will teach
  those generators to follow the same preset.
