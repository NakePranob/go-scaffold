# Spec Delta

## ADDED Requirements

### Requirement: The interview command returns a machine-readable schema

`go-scaffold interview --json` SHALL return the standard questions, options,
defaults, recommendations, dependencies, and preset sources. It MUST NOT write
any file or create a project directory.

#### Scenario: Agent requests the schema before create

- **GIVEN** an empty workspace
- **WHEN** the agent runs `go-scaffold interview --json`
- **THEN** the command exits 0 with a schema containing the project, feature,
  architecture, HTTP preset, and module profile questions
- **AND** the workspace remains empty

#### Scenario: Preset options include their source

- **GIVEN** `presets/acme-v1.json` exists
- **WHEN** the agent requests the interview schema
- **THEN** the `http.preset` question includes an `acme-v1` option with its
  source path and shape summary

### Requirement: Every standard question has a safe default and a reason

Each question that affects the generated contract SHALL include a default and,
where the choice is not obvious, a `recommended` option and a `why`
explanation. The agent MUST be able to proceed when the user does not know.

#### Scenario: User does not know the response standard

- **GIVEN** the user answers "I don't know" to the HTTP preset question
- **WHEN** the agent uses the schema
- **THEN** the recommended option is available with a reason
- **AND** the agent can explain the trade-off without inventing an option

### Requirement: Answers are validated before any write

`go-scaffold create --answers <file> --plan` SHALL validate every answer
against the interview schema. Unknown question IDs, unknown option values, and
missing required answers MUST fail with a stable error code before any write.

#### Scenario: Unknown option is rejected

- **GIVEN** an answers file with `http.preset: "unknown"`
- **WHEN** `create --plan` runs
- **THEN** it fails with `UNKNOWN_OPTION`
- **AND** no project directory or file is created

#### Scenario: Missing answer is rejected

- **GIVEN** an answers file without `project.name`
- **WHEN** `create --plan` runs
- **THEN** it fails with `MISSING_ANSWER`
- **AND** the error names the missing question ID

### Requirement: Plan writes nothing and apply writes the plan

`create --answers ... --plan` SHALL return the resolved contract, file counts,
and warnings without writing. `create --answers ... --apply` SHALL write the
planned files. The two modes MUST be mutually exclusive.

#### Scenario: Plan leaves the workspace unchanged

- **GIVEN** a valid answers file
- **WHEN** `create --plan --json` runs
- **THEN** it exits 0 with `writes: 0`
- **AND** the target directory does not exist
- **AND** the response includes `http.resolved` and `presetHash`

#### Scenario: Apply writes exactly the plan

- **GIVEN** a successful plan
- **WHEN** `create --apply` runs with the same answers
- **THEN** the created files match the plan's file list
- **AND** the persisted config contains the frozen `http.resolved` block

### Requirement: The bootstrap skill reads the schema instead of hardcoding it

The CLI SHALL ship a bootstrap skill. The skill MUST instruct the agent to run
`interview --json`, ask the user in their language, use the recommended option
only when needed, run `--plan`, show the result, wait for confirmation, then
run `--apply` and `check`. The skill MUST NOT contain a second copy of the
question list or the preset catalog.

#### Scenario: Skill and CLI stay aligned

- **GIVEN** a new question is added to `interview --json`
- **WHEN** the agent follows the bootstrap skill
- **THEN** the new question appears without changing the skill
- **AND** the agent does not invent options that the CLI does not return

### Requirement: The CLI owns standards and the agent owns the domain

The interview schema SHALL cover only CLI-owned standards: project shape,
features, architecture, and HTTP contract. Domain questions such as entity
fields, invariants, and module boundaries SHALL remain the agent's
responsibility and MUST NOT be required by the CLI schema.

#### Scenario: Agent adds domain questions

- **GIVEN** the CLI schema contains the standard questions
- **WHEN** the agent interviews the user about an `orders` entity
- **THEN** the agent may ask about fields and invariants
- **AND** those answers are not sent as CLI standard options
