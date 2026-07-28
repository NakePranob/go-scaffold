import { execFileSync } from "child_process";
import pc from "picocolors";
import { ProjectConfig } from "../types";
import { cliVersion } from "./version";

export interface CheckResult {
  ok: boolean;
  output: string;
}

// typeChecks runs `go vet ./...` in projectRoot. Returns null when there's no
// Go toolchain on PATH — the caller can't conclude anything either way then,
// the same graceful skip as gofmtTree.
//
// `go vet` rather than `go build`: build skips _test.go files entirely, and the
// generated handler_test.go is exactly where a shared/ signature change lands
// first (it constructs the middleware chain by hand). vet type-checks tests
// too, so it sees what build would miss.
export function typeChecks(projectRoot: string): CheckResult | null {
  try {
    execFileSync("go", ["version"], { stdio: "ignore" });
  } catch {
    return null;
  }
  try {
    execFileSync("go", ["vet", "./..."], { cwd: projectRoot, stdio: ["ignore", "pipe", "pipe"] });
    return { ok: true, output: "" };
  } catch (err) {
    const e = err as { stdout?: Buffer; stderr?: Buffer };
    return { ok: false, output: `${e.stderr?.toString() ?? ""}${e.stdout?.toString() ?? ""}`.trim() };
  }
}

// assertNoDrift is the second half of a before/after pair: given what
// typeChecks said *before* the files were written, it re-checks and fails
// loudly if generating is what broke the project.
//
// Why compare instead of just checking afterwards: a project can be mid-refactor
// (or simply not have run `go mod tidy` yet), and blaming the generator for a
// break it didn't cause is worse than staying quiet. Only the
// passed-before → broken-after transition is unambiguously ours.
//
// The failure this exists for: `generate` renders templates pinned to the
// shared/ layer that `create` emits, so once a project edits that layer — which
// is normal, expected work — the generated code stops compiling against it.
// Without this check that lands as a mystery build error some time later, in
// files the user never wrote.
export function assertNoDrift(projectRoot: string, before: CheckResult | null, config: ProjectConfig): void {
  if (before === null || !before.ok) return; // no Go here, or already broken — not ours to judge
  const after = typeChecks(projectRoot);
  if (after === null || after.ok) return;

  const scaffoldedWith = config.scaffoldVersion ?? "unknown (predates version stamping)";
  throw new Error(
    `${pc.red("the generated code doesn't compile, but this project was fine a moment ago.")}\n\n` +
      `The most likely cause is drift: this project's internal/shared layer has been edited\n` +
      `since it was scaffolded, so the templates this CLI emits no longer match it.\n\n` +
      `  scaffolded with: go-scaffold ${scaffoldedWith}\n` +
      `  this CLI:        go-scaffold ${cliVersion()}\n\n` +
      `${pc.dim("go vet ./... says:")}\n${after.output}\n\n` +
      `The generated files were left in place — reconcile them with your shared/ layer by\n` +
      `hand, or undo (\`go-scaffold remove module <name>\` for a module) and generate again\n` +
      `with a CLI version that matches this project.`
  );
}
