# Proposal

## Why

The generated HTTP contract is fixed:

- a single resource is a bare JSON object;
- a list is `{data, limit, offset, total}`;
- an error is `{error: {code, message, details?, request_id?}}`;
- delete is `204` with an empty body.

That default is reasonable, but it is not every company's standard. A company
may wrap every success in `{data, meta}`, use `{items, total}` for lists, or
return `{errors: [...]}` for failures. Today the generator cannot express those
choices, so a team either edits generated code by hand or stops using the
generator.

The existing `generic-http-contract` change centralizes the current shapes in
one writer and one error translator. It deliberately keeps the wire format
unchanged and does not add configuration. It is the foundation for this
change, not the final product.

There is also an interaction problem. The CLI is built for people who know how
to run it, but many users will reach it through an agent. Those users should
not have to learn flags, wizards, or `go-scaffold.config.json`. The agent
should ask the user the standard questions in natural language, show a plan
before writing anything, and let the CLI enforce the chosen standard.

Without a machine-readable interview, the agent skill has to hardcode the
questions and options. That duplicates the CLI's decisions, drifts when the
CLI changes, and makes `check` unable to enforce what the user actually chose.
Without a closed shape catalog, an agent that invents a new response shape
also invents a template the checker cannot verify.

## What Changes

- Add a closed catalog of response shapes for `single`, `list`, and `error`.
  Every shape has fixed field names. A shape may include the pagination
  layout for its list form.
- Add an `http` section to `go-scaffold.config.json` (schema version 3):
  the selected preset name, the resolved shape IDs, and a preset hash.
- Add company preset files under `presets/*.json`. A preset selects shape IDs
  only; it cannot define field names, templates, or new shapes.
- Add `go-scaffold interview --json`. It returns the standard questions,
  options, defaults, recommendations, dependencies, and the source of every
  preset. It writes nothing.
- Add `go-scaffold create --answers <file> --plan` and `--apply`. The plan
  resolves the preset, reports the exact response shapes and file counts, and
  writes nothing. `--apply` performs the writes.
- Add `go-scaffold preset list`, `validate`, `diff`, and `upgrade`.
- Generate `internal/shared/httpx` and the error middleware from the resolved
  shapes instead of hardcoding one envelope.
- Generate `docs/architect/http-contract.md` with the exact shapes, status
  codes, and error rules for the selected preset.
- Update `check` to enforce the resolved contract on generated inbound
  adapters. Custom handlers are reported as outside the contract, not failed.
- Ship a bootstrap skill with the CLI (`go-scaffold skill install` and
  `go-scaffold skill print --json`) and update the generated project skill so
  an agent can run the interview, plan, and apply flow without hardcoded
  questions.
- Add parametric QA tests that generate a project for every supported preset
  and assert the exact JSON bodies over real HTTP requests.

## Capabilities

### New Capabilities

- `http-contract-presets`: the closed shape catalog, preset files, resolved
  project config, and generated writers.
- `agent-project-interview`: the machine-readable question schema and the
  answers/plan/apply flow used by an agent.
- `cli-preset-management`: listing, validating, diffing, and upgrading
  presets.
- `http-contract-enforcement`: `check` rules for generated endpoints and the
  explicit boundary for custom endpoints.

### Modified Capabilities

- None. The repository has no archived capability specs yet.

## Impact

- `go-scaffold.config.json` schema version 3 and its migration.
- `src/commands/create.ts`, new `src/commands/interview.ts`,
  `src/commands/preset.ts`, `src/commands/skill.ts`.
- `src/utils/config.ts`, new `src/utils/presets.ts`,
  `src/utils/interview.ts`.
- `templates/create/base/internal/shared/httpx/*`,
  `templates/create/base/internal/shared/apperror/*`, and the error
  middleware template.
- `templates/create/base/docs/architect/http-contract.md.hbs`.
- `templates/create/base/.claude/skills/go-scaffold/SKILL.md.hbs` and a new
  bootstrap skill template.
- `tests/unit`, `tests/integration`, and `tests/qa`.
- `REFERENCE.md`, `README.md`, and `CHANGELOG.md`.

## Dependencies

`generic-http-contract` must land first. This change builds on its
`httpx.OK/Created/NoContent/Page` helpers, `apperror.Translate`, and executable
QA gate. The foundation keeps the current wire format; this change makes the
choice configurable.

## Out of Scope

- Arbitrary JSON shapes or a general mapping engine.
- Per-endpoint or per-module contract overrides.
- Request body, DTO field, or domain model configuration.
- Auth, MFA, and token success shapes. They stay fixed in v1; their errors use
  the selected error shape.
- A remote preset registry. Presets are local files passed by
  `--preset-dir` or found in the documented search paths.
- Enforcing custom, hand-written endpoints. v1 reports them as outside the
  contract. An opt-in annotation can be a later change.
- Rewriting existing generated handlers when a preset changes. `preset
  upgrade` changes the config used by future generation; existing handlers
  need an explicit regeneration or a manual migration.
- Updating the generated Next.js and SvelteKit clients to consume every
  non-default shape. That is a separate cross-scaffold change. Until it lands,
  `create --plan` must warn when a non-default preset is combined with a
  generated FSD client.
