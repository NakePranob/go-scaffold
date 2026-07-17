#!/usr/bin/env node
// End-to-end smoke test for the go-scaffold CLI: exercises create + generate
// module (full and minimal) + generate method against a real Go toolchain in
// a scratch directory, and checks the guard rails (bad names, duplicates,
// forbidden flags) actually reject. No Postgres required — integration
// tests inside the generated project skip gracefully if the DB isn't up,
// the same behavior the CLI itself scaffolds for every project.
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, existsSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const CLI = path.join(ROOT, "bin", "go-scaffold.js");

let passed = 0;
let scratch;

function step(name, fn) {
  process.stdout.write(`- ${name} ... `);
  try {
    fn();
    console.log("ok");
    passed++;
  } catch (err) {
    console.log("FAILED");
    console.error(err.stdout?.toString() ?? err.stderr?.toString() ?? err.message);
    cleanup();
    process.exit(1);
  }
}

function run(cmd, args, cwd, env) {
  return execFileSync(cmd, args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    env: env ? { ...process.env, ...env } : process.env,
  });
}

function goScaffold(args, cwd) {
  return run("node", [CLI, ...args], cwd);
}

function expectThrows(fn, messageFragment) {
  try {
    fn();
  } catch (err) {
    const msg = (err.stdout?.toString() ?? "") + (err.stderr?.toString() ?? "") + err.message;
    if (!msg.includes(messageFragment)) {
      throw new Error(`expected error containing "${messageFragment}", got: ${msg}`);
    }
    return;
  }
  throw new Error(`expected an error containing "${messageFragment}", but it succeeded`);
}

function assertFileContains(filePath, needle) {
  if (!existsSync(filePath)) throw new Error(`missing file: ${filePath}`);
  const content = readFileSync(filePath, "utf8");
  if (!content.includes(needle)) throw new Error(`${filePath} doesn't contain "${needle}"`);
}

function cleanup() {
  if (scratch && existsSync(scratch)) rmSync(scratch, { recursive: true, force: true });
}

if (!existsSync(path.join(ROOT, "dist", "index.js"))) {
  console.error("dist/index.js missing — run `pnpm run build` first");
  process.exit(1);
}
try {
  run("go", ["version"]);
} catch {
  console.error("no Go toolchain on PATH — required for the smoke test");
  process.exit(1);
}

scratch = mkdtempSync(path.join(tmpdir(), "go-scaffold-smoke-"));
console.log(`scratch dir: ${scratch}\n`);

step("rejects an invalid project name before writing anything", () => {
  expectThrows(() => goScaffold(["create", "My Cool App", "--defaults"], scratch), "invalid project name");
});

step("create --defaults scaffolds a bare project", () => {
  goScaffold(["create", "full-app", "--defaults"], scratch);
  assertFileContains(path.join(scratch, "full-app", "go.mod"), "module full-app");
});

const fullApp = path.join(scratch, "full-app");
step("bare project: go mod tidy + build + vet", () => {
  run("go", ["mod", "tidy"], fullApp);
  run("go", ["build", "./..."], fullApp);
  run("go", ["vet", "./..."], fullApp);
});

step("bare project: CI workflow renders with the right db name, valid trigger keys", () => {
  assertFileContains(path.join(fullApp, ".github", "workflows", "ci.yml"), "POSTGRES_DB: full_app");
  assertFileContains(path.join(fullApp, ".github", "workflows", "ci.yml"), "golangci-lint-action");
});

let hasGolangciLint = true;
try {
  run("golangci-lint", ["--version"]);
  // golangci-lint's result cache is keyed by file content, not absolute path —
  // this suite regenerates byte-identical "widget"/"order" packages across many
  // scratch dirs, so a stale cache entry (e.g. from before a template fix) can
  // get served with a file path from a since-deleted run. Start from empty.
  run("golangci-lint", ["cache", "clean"]);
} catch {
  hasGolangciLint = false;
}

step(
  hasGolangciLint
    ? "bare project: golangci-lint is clean out of the box (the CI gate the scaffold ships would pass)"
    : "bare project: golangci-lint not installed locally — skipping a real run",
  () => {
    if (!hasGolangciLint) return;
    const out = run("golangci-lint", ["run"], fullApp);
    if (out.trim() && !out.includes("0 issues")) throw new Error(`expected 0 issues, got:\n${out}`);
  }
);

let hasPsql = true;
try {
  run("psql", ["--version"]);
} catch {
  hasPsql = false;
}

let dockerPgContainer = null;
if (!hasPsql) {
  try {
    dockerPgContainer = run("docker", ["ps", "-q", "--filter", "publish=5432"]).trim().split("\n")[0] || null;
  } catch {
    dockerPgContainer = null;
  }
}

function listDatabases() {
  return hasPsql
    ? run("psql", ["-h", "localhost", "-U", "postgres", "-lqt"], undefined, { PGPASSWORD: "postgres" })
    : run("docker", ["exec", "-e", "PGPASSWORD=postgres", dockerPgContainer, "psql", "-U", "postgres", "-lqt"]);
}

step(
  hasPsql
    ? "make db-create is idempotent and actually creates the DB"
    : dockerPgContainer
      ? "make db-create falls back to docker exec (no local psql) and actually creates the DB"
      : "make db-create parses (no psql, no Postgres container — skipping a real run)",
  () => {
    if (!hasPsql && !dockerPgContainer) {
      run("make", ["-n", "db-create"], fullApp); // dry run: catches Makefile/shell syntax errors
      return;
    }
    run("make", ["db-drop"], fullApp); // start from a clean slate in case a prior run left it
    run("make", ["db-create"], fullApp);
    run("make", ["db-create"], fullApp); // must not error the second time
    const list = listDatabases();
    if (!list.includes("full_app")) throw new Error(`expected database "full_app" to exist, got:\n${list}`);
    run("make", ["db-drop"], fullApp);
  }
);

step("generate module order (full CRUD)", () => {
  goScaffold(["generate", "module", "order"], fullApp);
});

step("full module: docs wired into openapi.yaml", () => {
  assertFileContains(path.join(fullApp, "docs", "openapi.yaml"), "/v1/orders:");
  assertFileContains(path.join(fullApp, "docs", "openapi.yaml"), "OrderResponse");
});

step("main.go serves the whole docs/ tree, not just the index (or $ref resolution 404s over HTTP)", () => {
  assertFileContains(path.join(fullApp, "cmd", "api", "main.go"), 'r.Static("/docs", "./docs")');
});

let hasNpx = true;
try {
  run("npx", ["--version"]);
} catch {
  hasNpx = false;
}

step(
  hasNpx
    ? "make openapi-bundle resolves every $ref into one file (for importers like Bruno that don't)"
    : "make openapi-bundle skipped (npx not available)",
  () => {
    if (!hasNpx) return;
    run("make", ["openapi-bundle"], fullApp);
    const bundlePath = path.join(fullApp, "docs", "openapi.bundled.yaml");
    assertFileContains(bundlePath, "get:");
    assertFileContains(bundlePath, "post:");
    // the whole point: no $ref left pointing at a sibling file
    const bundled = readFileSync(bundlePath, "utf8");
    if (bundled.includes("$ref: './")) throw new Error("bundled spec still has unresolved external $refs");
  }
);

step("re-generating after deleting only the folder doesn't duplicate wiring (would panic gin)", () => {
  // simulate: user rm -rf's the module dir but main.go/openapi.yaml still
  // reference it, then re-runs generate module. Must stay a single Register.
  rmSync(path.join(fullApp, "internal", "app", "order"), { recursive: true, force: true });
  goScaffold(["generate", "module", "order"], fullApp);
  const mainGo = readFileSync(path.join(fullApp, "cmd", "api", "main.go"), "utf8");
  const registers = (mainGo.match(/order\.NewHandler\(/g) ?? []).length;
  if (registers !== 1) throw new Error(`expected exactly 1 order route registration, got ${registers}`);
  const openapi = readFileSync(path.join(fullApp, "docs", "openapi.yaml"), "utf8");
  const paths = (openapi.match(/\/v1\/orders:/g) ?? []).length;
  if (paths !== 1) throw new Error(`expected exactly 1 /v1/orders path in openapi.yaml, got ${paths}`);
  const migrations = readdirSync(path.join(fullApp, "migrations")).filter((f) => f.endsWith("_create_orders.up.sql")).length;
  if (migrations !== 1) throw new Error(`expected exactly 1 create_orders migration, got ${migrations}`);
});

step("full module: build + vet + gofmt clean", () => {
  run("go", ["build", "./..."], fullApp);
  run("go", ["vet", "./..."], fullApp);
  const dirty = run("gofmt", ["-l", "."], fullApp).trim();
  if (dirty) throw new Error(`gofmt found unformatted files:\n${dirty}`);
});

step("full module: go test ./... (integration tests skip without a DB)", () => {
  run("go", ["test", "./..."], fullApp);
});

for (const [name, args] of Object.entries({
  "patch (resource action)": ["approve", "--type", "patch"],
  "get --get-mode all": ["findActive", "--type", "get", "--get-mode", "all"],
  "get --get-mode one --field": ["findByStatus", "--type", "get", "--get-mode", "one", "--field", "status"],
  post: ["archive", "--type", "post"],
  delete: ["removeAttachment", "--type", "delete"],
})) {
  step(`generate method order: ${name}`, () => {
    goScaffold(["generate", "method", "order", ...args], fullApp);
  });
}

step("after 5 generate method calls: build + vet + gofmt + test", () => {
  run("go", ["build", "./..."], fullApp);
  run("go", ["vet", "./..."], fullApp);
  const dirty = run("gofmt", ["-l", "."], fullApp).trim();
  if (dirty) throw new Error(`gofmt found unformatted files:\n${dirty}`);
  run("go", ["test", "./..."], fullApp);
});

step(
  hasGolangciLint
    ? "after 5 generate method calls: still lint-clean"
    : "after 5 generate method calls: lint check skipped (golangci-lint not installed)",
  () => {
    if (!hasGolangciLint) return;
    const out = run("golangci-lint", ["run"], fullApp);
    if (out.trim() && !out.includes("0 issues")) throw new Error(`expected 0 issues, got:\n${out}`);
  }
);

step("generate method rejects a duplicate method name", () => {
  expectThrows(() => goScaffold(["generate", "method", "order", "approve", "--type", "patch"], fullApp), "already exists");
});

step("generate method rejects --field id", () => {
  expectThrows(
    () => goScaffold(["generate", "method", "order", "findById", "--type", "get", "--get-mode", "one", "--field", "id"], fullApp),
    'cannot be "id"'
  );
});

step("generate module rejects a name that already exists", () => {
  expectThrows(() => goScaffold(["generate", "module", "order"], fullApp), "already exists");
});

step("rejects reserved Go words before writing broken code (module/method/field)", () => {
  expectThrows(() => goScaffold(["generate", "module", "type"], fullApp), "reserved Go word");
  expectThrows(() => goScaffold(["generate", "module", "string"], fullApp), "reserved Go word");
  expectThrows(() => goScaffold(["generate", "method", "order", "func", "--type", "post"], fullApp), "Go keyword");
  expectThrows(
    () => goScaffold(["generate", "method", "order", "findByType", "--type", "get", "--get-mode", "one", "--field", "type"], fullApp),
    "Go keyword"
  );
  expectThrows(() => goScaffold(["generate", "module", "2fa"], fullApp), "starts with a digit");
});

step("remove module reverses wiring and re-generating stays clean", () => {
  goScaffold(["generate", "module", "widget"], fullApp);
  run("go", ["build", "./..."], fullApp);
  goScaffold(["remove", "module", "widget", "--yes"], fullApp);
  if (existsSync(path.join(fullApp, "internal", "app", "widget"))) throw new Error("widget folder not deleted");
  const mainGo = readFileSync(path.join(fullApp, "cmd", "api", "main.go"), "utf8");
  if (mainGo.includes("widget.NewHandler")) throw new Error("main.go still wires widget after remove");
  const openapi = readFileSync(path.join(fullApp, "docs", "openapi.yaml"), "utf8");
  if (openapi.includes("/v1/widgets:")) throw new Error("openapi still lists widgets after remove");
  run("go", ["build", "./..."], fullApp); // must still compile with widget gone
  goScaffold(["generate", "module", "widget"], fullApp); // re-adding must not duplicate
  const registers = (readFileSync(path.join(fullApp, "cmd", "api", "main.go"), "utf8").match(/widget\.NewHandler\(/g) ?? []).length;
  if (registers !== 1) throw new Error(`expected 1 widget registration after re-add, got ${registers}`);
  run("go", ["build", "./..."], fullApp);
});

step("create --api-prefix beta scaffolds routes under a custom prefix", () => {
  goScaffold(["create", "beta-app", "--defaults", "--api-prefix", "beta"], scratch);
});

const betaApp = path.join(scratch, "beta-app");
step("custom prefix: generate module + method, routes land under /beta", () => {
  run("go", ["mod", "tidy"], betaApp);
  goScaffold(["generate", "module", "product"], betaApp);
  goScaffold(["generate", "method", "product", "findByStatus", "--type", "get", "--get-mode", "one", "--field", "status"], betaApp);
  const mainGo = readFileSync(path.join(betaApp, "cmd", "api", "main.go"), "utf8");
  if (!mainGo.includes('api := r.Group("/beta")')) throw new Error('expected api := r.Group("/beta") in main.go');
  const openapi = readFileSync(path.join(betaApp, "docs", "openapi.yaml"), "utf8");
  if (!openapi.includes("/beta/products:")) throw new Error("expected /beta/products in openapi.yaml");
  run("go", ["build", "./..."], betaApp);
  run("go", ["vet", "./..."], betaApp);
});

step("create --api-prefix '' scaffolds routes with no prefix at all", () => {
  goScaffold(["create", "noprefix-app", "--defaults", "--api-prefix", ""], scratch);
  const app = path.join(scratch, "noprefix-app");
  run("go", ["mod", "tidy"], app);
  goScaffold(["generate", "module", "widget"], app);
  const mainGo = readFileSync(path.join(app, "cmd", "api", "main.go"), "utf8");
  if (!mainGo.includes('api := r.Group("/")')) throw new Error('expected api := r.Group("/") in main.go');
  const openapi = readFileSync(path.join(app, "docs", "openapi.yaml"), "utf8");
  if (!openapi.includes("/widgets:")) throw new Error("expected /widgets (no prefix) in openapi.yaml");
  if (openapi.includes("/v1/widgets:")) throw new Error("should not have a /v1 prefix");
  run("go", ["build", "./..."], app);
  run("go", ["vet", "./..."], app);
});

step("create --api-prefix api/v1 supports multi-segment prefixes (gin joins them fine)", () => {
  goScaffold(["create", "multiseg-app", "--defaults", "--api-prefix", "/api/v1/"], scratch);
  const app = path.join(scratch, "multiseg-app");
  const cfg = JSON.parse(readFileSync(path.join(app, "go-scaffold.config.json"), "utf8"));
  if (cfg.apiPrefix !== "api/v1") throw new Error(`expected leading/trailing slashes stripped, got "${cfg.apiPrefix}"`);
  run("go", ["mod", "tidy"], app);
  goScaffold(["generate", "module", "order"], app);
  const mainGo = readFileSync(path.join(app, "cmd", "api", "main.go"), "utf8");
  if (!mainGo.includes('api := r.Group("/api/v1")')) throw new Error('expected api := r.Group("/api/v1") in main.go');
  const openapi = readFileSync(path.join(app, "docs", "openapi.yaml"), "utf8");
  if (!openapi.includes("/api/v1/orders:")) throw new Error("expected /api/v1/orders in openapi.yaml");
  run("go", ["build", "./..."], app);
  run("go", ["vet", "./..."], app);
});

step("create --no-full minimal module layers up to full build", () => {
  goScaffold(["create", "min-app", "--defaults"], scratch);
  const minApp = path.join(scratch, "min-app");
  run("go", ["mod", "tidy"], minApp);
  goScaffold(["generate", "module", "widget", "--no-full"], minApp);
  run("go", ["build", "./..."], minApp);
  if (hasGolangciLint) {
    // bare minimal module, zero methods yet: the ahead-of-use plumbing
    // (fakeRepo, test harness, wrapFindErr, response/toResponse) must not
    // trip `unused` before anything has wired it in.
    const out = run("golangci-lint", ["run"], minApp);
    if (out.trim() && !out.includes("0 issues")) throw new Error(`bare minimal module: expected 0 issues, got:\n${out}`);
  }
  goScaffold(["generate", "method", "widget", "create", "--type", "post"], minApp);
  goScaffold(["generate", "method", "widget", "list", "--type", "get", "--get-mode", "all"], minApp);
  goScaffold(["generate", "method", "widget", "findByStatus", "--type", "get", "--get-mode", "one", "--field", "status"], minApp);
  run("go", ["build", "./..."], minApp);
  run("go", ["vet", "./..."], minApp);
  const dirty = run("gofmt", ["-l", "."], minApp).trim();
  if (dirty) throw new Error(`gofmt found unformatted files:\n${dirty}`);
  if (hasGolangciLint) {
    const out = run("golangci-lint", ["run"], minApp);
    if (out.trim() && !out.includes("0 issues")) throw new Error(`layered minimal module: expected 0 issues, got:\n${out}`);
  }
});

cleanup();
console.log(`\n${passed} checks passed.`);
