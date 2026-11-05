# Spec Delta

## ADDED Requirements

### Requirement: Presets can be listed and inspected

`go-scaffold preset list --preset-dir <dir> --json` SHALL return built-in and
company presets with their name, description, shape IDs, and source path. The
command MUST NOT write or modify files.

#### Scenario: Built-in and company presets appear together

- **GIVEN** `presets/acme-v1.json` and the built-in `default` preset
- **WHEN** `preset list --preset-dir ./presets --json` runs
- **THEN** both presets are returned
- **AND** each entry names its source

#### Scenario: Empty preset directory is not fatal

- **GIVEN** a preset directory with no JSON files
- **WHEN** `preset list` runs
- **THEN** it exits 0 with the built-in presets
- **AND** it reports the empty directory as informational

### Requirement: Presets are validated before use

`go-scaffold preset validate <file>` SHALL validate the schema version, the
unique name, every shape ID, and unknown keys. It MUST return structured
errors and MUST NOT modify the project or the preset file.

#### Scenario: Unknown shape fails validation

- **GIVEN** a preset with `single: "wrapped"`
- **WHEN** `preset validate` runs
- **THEN** it exits non-zero with `UNKNOWN_SHAPE`
- **AND** the error lists the supported single shapes

#### Scenario: Unknown key fails validation

- **GIVEN** a preset with a top-level `templates` key
- **WHEN** `preset validate` runs
- **THEN** it exits non-zero with `UNKNOWN_KEY`
- **AND** the error names the offending key

#### Scenario: Duplicate name fails validation

- **GIVEN** two preset files both named `acme-v1`
- **WHEN** `preset list` or `preset validate` loads the directory
- **THEN** it fails with `DUPLICATE_PRESET`
- **AND** the error names both files

### Requirement: Preset drift is visible and explicit

`go-scaffold preset diff` SHALL compare the frozen `http.resolved` block with
the current preset file and print a field-level difference. `preset upgrade`
SHALL print the same difference, list generated files that still use the old
shapes, and require explicit confirmation before changing the config. It MUST
NOT rewrite generated handlers.

#### Scenario: Preset changed after create

- **GIVEN** a project frozen on `acme-v1` with `list: data-meta`
- **AND** the preset file now selects `list: items-total`
- **WHEN** `preset diff --preset-dir ./presets` runs
- **THEN** it reports `list: data-meta -> items-total`
- **AND** `check` warns that the preset hash differs
- **AND** the project does not change until `preset upgrade` is confirmed

#### Scenario: Upgrade requires confirmation

- **GIVEN** a non-empty diff
- **WHEN** `preset upgrade --preset-dir ./presets` runs without `--yes`
- **THEN** it prints the diff and exits without changing the config
- **AND** it lists existing generated files that still use the old shapes

### Requirement: Preset discovery is local and explicit

The CLI SHALL load presets from `--preset-dir` and from the documented local
search paths. It MUST NOT contact a remote registry in this change. A missing
preset MUST fail with `PRESET_NOT_FOUND` and the searched paths.

#### Scenario: Missing company preset

- **GIVEN** an answers file that selects `acme-v1`
- **AND** no `acme-v1.json` in any search path
- **WHEN** `create --plan` runs
- **THEN** it fails with `PRESET_NOT_FOUND`
- **AND** the error lists the searched paths
- **AND** no project is created
