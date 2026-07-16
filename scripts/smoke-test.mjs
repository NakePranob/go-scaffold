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

step("create --no-full minimal module layers up to full build", () => {
  goScaffold(["create", "min-app", "--defaults"], scratch);
  const minApp = path.join(scratch, "min-app");
  run("go", ["mod", "tidy"], minApp);
  goScaffold(["generate", "module", "widget", "--no-full"], minApp);
  run("go", ["build", "./..."], minApp);
  goScaffold(["generate", "method", "widget", "create", "--type", "post"], minApp);
  goScaffold(["generate", "method", "widget", "list", "--type", "get", "--get-mode", "all"], minApp);
  run("go", ["build", "./..."], minApp);
  run("go", ["vet", "./..."], minApp);
  const dirty = run("gofmt", ["-l", "."], minApp).trim();
  if (dirty) throw new Error(`gofmt found unformatted files:\n${dirty}`);
});

cleanup();
console.log(`\n${passed} checks passed.`);
