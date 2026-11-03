# Contributing to @nakedev/go-scaffold

This repository publishes the CLI and the templates it emits. A template
change is a change to every generated project, so treat it as a public
contract, not a local convenience.

## Merge policy

`main` and `develop` are protected by repository rulesets that require a
pull request; direct pushes are blocked. Only squash merges are enabled in the
repository settings, so every PR lands as one commit. Do not use merge commits
or rebase merges for these branches.

## Branch model

- `main` is the release branch. It is protected and accepts PRs only from
  `develop` or `release/vX.Y.Z`.
- `develop` is the integration branch. It is protected; normal feature, fix,
  chore, and documentation branches start here and return here.
- `feat/*`, `fix/*`, `chore/*`, and `docs/*` are short-lived work branches.
  Branch from an up-to-date `develop`.
- `release/vX.Y.Z` prepares a release. Branch from `develop`, bump
  `package.json`, open a PR to `main`, then tag the merged commit.
- `hotfix/*` is only for an urgent production correction. Start from `main`,
  open the PR as `release/vX.Y.Z` when the main policy applies, then merge the
  result back into `develop`.

## Normal flow

1. `git fetch origin`
2. `git switch develop && git pull --ff-only`
3. `git switch -c fix/<topic>` (or `feat/`, `chore/`, `docs/`)
4. Implement the change with its tests and documentation.
5. Run the checks that cover the changed surface. For template changes, this
   includes generating at least one affected project and running its tests.
6. Commit with the repository format: `<type>: <emoji> <description>`.
7. Push the work branch and open a PR into `develop`.
8. After review and green CI, merge. Re-sync `develop` from `main` whenever
   `main` has moved.

Do not open a feature PR directly against `main`. The `main-merge-policy`
workflow rejects a branch that is not `develop` or `release/*` and requires
`package.json` to be higher than the base version.

## Pull request rules

- Keep one concern per PR. A template fix, a CLI refactor, and a release bump
  are separate PRs.
- Do not force-push a shared branch. Update your own branch with a normal
  merge or rebase.
- Include an upgrade or migration note whenever generated projects need a
  manual step.
- State which checks were not run and why. A skipped external check is not a
  passing check.
- Required status checks are `verify`, `packaged-artifact`, and, for PRs to
  `main`, `main-merge-policy`.

## Checks

```bash
pnpm install --frozen-lockfile
pnpm run build
pnpm run test:unit
pnpm run test:integration
pnpm run test:smoke          # needs Docker/PostgreSQL, migrate, golangci-lint
pnpm run release:check -- vX.Y.Z
```

For generated-project changes, also run the relevant generated project’s
`go test`, `go vet`, and `go-scaffold check`. The smoke suite is the full gate
for templates; do not replace it with a unit-only run when a template changed.

## Branch protection checklist

Configure these in GitHub repository settings; they cannot be enforced by a
file in the repository:

- Require a pull request before merging on `main` and `develop`.
- Require `verify` and `packaged-artifact`; require `main-merge-policy` on
  `main`.
- Dismiss stale approvals after new commits.
- Require the branch to be up to date before merging.
- Block force-pushes and deletions on `main` and `develop`.
- Delete merged work branches automatically; keep `release/*` only while its
  release is active.

## Release

`package.json` is the version source. Create `release/vX.Y.Z` from `develop`,
bump the version, run `pnpm run release:check -- vX.Y.Z` on the exact commit,
merge to `main`, then push the annotated tag. The release workflow publishes
only from that tagged commit.
