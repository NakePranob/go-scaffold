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

test("remove module preserves immutable migrations and re-add reuses them", () => {
  const scratch = mkdtempSync(path.join(tmpdir(), "go-scaffold-remove-"));
  try {
    runCLI(scratch, "create", "sample", "--defaults", "--no-docker");
    const project = path.join(scratch, "sample");
    runCLI(project, "generate", "module", "widgets");
    runCLI(project, "generate", "method", "widgets", "approve", "--type", "patch");

    const before = createMigrations(project, "widgets");
    assert.equal(before.length, 2);
    const openapiPath = path.join(project, "docs", "openapi.yaml");
    assert.match(readFileSync(openapiPath, "utf8"), /\/v1\/widgets\/\{id\}\/approve:/);

    const output = runCLI(project, "remove", "module", "widgets", "--yes");

    assert.equal(existsSync(path.join(project, "internal", "app", "widget")), false);
    assert.deepEqual(createMigrations(project, "widgets"), before);
    assert.match(output, /preserved migration history/);
    assert.match(output, /generate migration drop_widgets/);
    assert.doesNotMatch(readFileSync(openapiPath, "utf8"), /\.\/widgets\//);

    runCLI(project, "generate", "module", "widgets");
    assert.deepEqual(createMigrations(project, "widgets"), before);
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
});
