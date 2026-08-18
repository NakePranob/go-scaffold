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

// parseChecks asks the weaker question typeChecks can't: does every .go file
// in the tree still *parse*? gofmt only reads files, so this works before
// `go mod tidy` has resolved a new feature's third-party imports — which is
// precisely when `add auth`/`add worker`/`add observability` do their most
// invasive patching and when `go vet` is guaranteed to fail for reasons that
// have nothing to do with us.
export function parseChecks(projectRoot: string): CheckResult | null {
  try {
    execFileSync("gofmt", ["-l", "-e", "."], { cwd: projectRoot, stdio: ["ignore", "pipe", "pipe"] });
    return { ok: true, output: "" };
  } catch (err) {
    const e = err as NodeJS.ErrnoException & { stdout?: Buffer; stderr?: Buffer };
    if (e.code === "ENOENT") return null; // no Go toolchain — can't conclude anything
    return { ok: false, output: `${e.stderr?.toString() ?? ""}`.trim() };
  }
}

// assertStillParses is the before/after pair for a command that patches files
// rather than only adding them. A marker patch that lands in the wrong place
// produces Go that doesn't parse, and without this the command goes on to
// print success over it — gofmt's own failure used to be swallowed whole.
//
// Same "only blame yourself for a passed → broken transition" rule as
// assertNoDrift: a project that already had an unparseable file (mid-edit, a
// scratch file) is not this command's problem.
export function assertStillParses(projectRoot: string, before: CheckResult | null, didWhat: string): void {
  if (before === null || !before.ok) return;
  const after = parseChecks(projectRoot);
  if (after === null || after.ok) return;

  throw new Error(
    `${pc.red(`${didWhat}, but the result is not valid Go — a patch landed somewhere it doesn't fit.`)}\n\n` +
      `${pc.dim("gofmt says:")}\n${after.output}\n\n` +
      `The files were left as-is so you can see the damage. Most likely one of the files this\n` +
      `command patches was hand-edited away from the shape it was generated in. Please report\n` +
      `this if that isn't the case — the CLI should never write Go that doesn't parse.`
  );
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
export function assertNoDrift(
  projectRoot: string,
  before: CheckResult | null,
  config: ProjectConfig,
  // What the command did, for commands that patch rather than generate
  // (`add rbac`, `undo module`). Their failure isn't template drift, it's a
  // marker patch that landed against a main.go it didn't recognise.
  patched?: { didWhat: string; recover: string }
): void {
  if (before === null || !before.ok) return; // no Go here, or already broken — not ours to judge
  const after = typeChecks(projectRoot);
  if (after === null || after.ok) return;

  const scaffoldedWith = config.scaffoldVersion ?? "unknown (predates version stamping)";
  const versions =
    `  scaffolded with: go-scaffold ${scaffoldedWith}\n` +
    `  this CLI:        go-scaffold ${cliVersion()}\n\n` +
    `${pc.dim("go vet ./... says:")}\n${after.output}`;

  if (patched) {
    throw new Error(
      `${pc.red(`${patched.didWhat}, but the project no longer compiles.`)}\n\n` +
        `This command patches existing files at marker comments. If those files were\n` +
        `hand-edited — or were written by a different CLI version — a patch can land\n` +
        `somewhere it doesn't fit, and the result only shows up as a build error.\n\n` +
        `${versions}\n\n${patched.recover}`
    );
  }

  throw new Error(
    `${pc.red("the generated code doesn't compile, but this project was fine a moment ago.")}\n\n` +
      `The most likely cause is drift: this project's internal/shared layer has been edited\n` +
      `since it was scaffolded, so the templates this CLI emits no longer match it.\n\n` +
      `${versions}\n\n` +
      `The generated files were left in place — reconcile them with your shared/ layer by\n` +
      `hand, or undo (\`go-scaffold undo module <name>\` for a module) and generate again\n` +
      `with a CLI version that matches this project.`
  );
}
