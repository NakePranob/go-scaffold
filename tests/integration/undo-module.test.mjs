import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
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
    runCLI(scratch, "create", "sample", "--defaults", "--no-docker");
    const project = path.join(scratch, "sample");
    runCLI(project, "generate", "module", "widgets");
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

    runCLI(project, "generate", "module", "widgets");
    assert.equal(createMigrations(project, "widgets").length, 2);
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
});

test("undo module refuses, and destroys nothing, once the migrations are committed", () => {
  const scratch = mkdtempSync(path.join(tmpdir(), "go-scaffold-undo-tracked-"));
  try {
    runCLI(scratch, "create", "sample", "--defaults", "--no-docker");
    const project = path.join(scratch, "sample");
    runCLI(project, "generate", "module", "widgets");
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
    assert.match(readFileSync(path.join(project, "cmd", "api", "main.go"), "utf8"), /internal\/app\/widget/);
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
});
