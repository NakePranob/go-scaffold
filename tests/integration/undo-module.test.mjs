import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(path.dirname(path.dirname(fileURLToPath(import.meta.url))));
const CLI = path.join(ROOT, "bin", "go-scaffold.js");

function runCLI(cwd, ...args) {
  return execFileSync("node", [CLI, ...args], {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function createMigrations(project, table) {
  return readdirSync(path.join(project, "migrations")).filter((entry) =>
    entry.includes(`_create_${table}.`)
  );
}

// -c on every invocation: the test must not depend on (or pick up) whatever
// user.name / gpg signing the machine running it has configured globally.
function git(project, ...args) {
  execFileSync("git", ["-c", "user.email=test@example.com", "-c", "user.name=test", "-c", "commit.gpgsign=false", ...args], {
    cwd: project,
    stdio: "ignore",
  });
}

test("undo module deletes the migrations it generated and re-generating stays clean", () => {
  const scratch = mkdtempSync(path.join(tmpdir(), "go-scaffold-undo-"));
  try {
    runCLI(scratch, "create", "sample", "--defaults", "--no-docker", "--api-prefix", "v1");
    const project = path.join(scratch, "sample");
    runCLI(project, "generate", "module", "widgets", "--defaults");
    runCLI(project, "generate", "method", "widgets", "approve", "--type", "patch");

    assert.equal(createMigrations(project, "widgets").length, 2);
    const openapiPath = path.join(project, "docs", "openapi.yaml");
    assert.match(readFileSync(openapiPath, "utf8"), /\/v1\/widgets\/\{id\}\/approve:/);

    const output = runCLI(project, "undo", "module", "widgets", "--yes");

    assert.equal(existsSync(path.join(project, "internal", "app", "widget")), false);
    // uncommitted and unapplied, so they exist nowhere but this working tree —
    // leaving them behind is what made a typo'd module's migration run on
    // every database forever (migrations/embed.go is a `//go:embed *`)
    assert.deepEqual(createMigrations(project, "widgets"), []);
    assert.match(output, /deleted migrations\//);
    assert.doesNotMatch(readFileSync(openapiPath, "utf8"), /\.\/widgets\//);

    runCLI(project, "generate", "module", "widgets", "--defaults");
    assert.equal(createMigrations(project, "widgets").length, 2);
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
});

test("undo module refuses, and destroys nothing, once the migrations are committed", () => {
  const scratch = mkdtempSync(path.join(tmpdir(), "go-scaffold-undo-tracked-"));
  try {
    runCLI(scratch, "create", "sample", "--defaults", "--no-docker", "--api-prefix", "v1");
    const project = path.join(scratch, "sample");
    runCLI(project, "generate", "module", "widgets", "--defaults");
    const migrations = createMigrations(project, "widgets");
    assert.equal(migrations.length, 2);

    git(project, "init", "-q");
    git(project, "add", "-A");
    git(project, "commit", "-qm", "scaffold");

    // committed means it may already have been pulled or deployed elsewhere,
    // so the file can't be deleted — and nothing else may be either
    assert.throws(() => runCLI(project, "undo", "module", "widgets", "--yes"), /git knows about these migrations/);

    assert.equal(existsSync(path.join(project, "internal", "app", "widget")), true);
    assert.deepEqual(createMigrations(project, "widgets"), migrations);
    assert.match(readFileSync(path.join(project, "cmd", "api", "wiring.go"), "utf8"), /internal\/app\/widget/);
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
});

// findDependents dropped the closing quote so it would also catch the /model
// subpackage — which made it match on a bare prefix, and `undo module order`
// was then refused by every module whose name merely starts with "order".
// internal/app/orderitem imports nothing from internal/app/order; the second
// path just contains the first.
test("undo module is not blocked by a module whose name only shares a prefix", () => {
  const scratch = mkdtempSync(path.join(tmpdir(), "go-scaffold-undo-prefix-"));
  try {
    runCLI(scratch, "create", "sample", "--defaults", "--no-docker", "--api-prefix", "v1");
    const project = path.join(scratch, "sample");
    runCLI(project, "generate", "module", "orders", "--full", "--defaults");
    runCLI(project, "generate", "module", "order-items", "--full", "--defaults");

    runCLI(project, "undo", "module", "order", "--yes");

    assert.equal(existsSync(path.join(project, "internal", "app", "order")), false);
    assert.ok(
      existsSync(path.join(project, "internal", "app", "orderitem")),
      "the module that merely shares a prefix must survive"
    );
    const mainGo = readFileSync(path.join(project, "cmd", "api", "wiring.go"), "utf8");
    assert.doesNotMatch(mainGo, /app\/order"/, "order's own import must be gone");
    assert.match(mainGo, /app\/orderitem"/, "orderitem's wiring must be untouched");
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
});

// ...and the guard still has to fire for a real dependency, or loosening the
// match would have traded a false positive for a project that stops compiling.
test("undo module still refuses when another domain genuinely imports it", () => {
  const scratch = mkdtempSync(path.join(tmpdir(), "go-scaffold-undo-realdep-"));
  try {
    runCLI(scratch, "create", "sample", "--defaults", "--no-docker", "--api-prefix", "v1");
    const project = path.join(scratch, "sample");
    runCLI(project, "generate", "module", "orders", "--full", "--defaults");
    runCLI(project, "generate", "module", "invoices", "--full", "--defaults");

    const servicePath = path.join(project, "internal", "app", "invoice", "service.go");
    writeFileSync(
      servicePath,
      readFileSync(servicePath, "utf8").replace(
        "import (",
        'import (\n\tordermodel "sample/internal/app/order/model"'
      )
    );

    assert.throws(
      () => runCLI(project, "undo", "module", "order", "--yes"),
      /still used by/,
      "a genuine cross-domain import must still block the undo"
    );
    assert.ok(existsSync(path.join(project, "internal", "app", "order")), "nothing may be deleted");
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
});
