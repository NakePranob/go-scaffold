import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(path.dirname(path.dirname(fileURLToPath(import.meta.url))));
const CLI = path.join(ROOT, "bin", "go-scaffold.js");

function runCLI(cwd, ...args) {
  return execFileSync("node", [CLI, ...args], { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
}

function wiring(project) {
  return readFileSync(path.join(project, "cmd", "api", "wiring.go"), "utf8");
}

/**
 * The schema is the migrations', in every environment.
 *
 * A db.AutoMigrate bootstrap for development builds tables from the Go
 * structs, so it writes none of the CHECK constraints, none of the foreign
 * keys and none of the seeded rows the SQL carries — and it is additive over
 * an already-migrated database, so a column a model has and a migration does
 * not appears on one machine and nowhere else. Booting with "run the
 * migrations" is the better answer, and the version check is what says it.
 */
function assertSchemaComesFromMigrations(project, what) {
  const content = wiring(project);
  // The call, not the word: the comment above the version check explains why
  // there is no bootstrap, and says "AutoMigrate" to do it.
  assert.doesNotMatch(content, /db\.AutoMigrate\(/, `${what}: wiring.go must not bootstrap schema`);
  assert.doesNotMatch(content, /db\.Exec\("CREATE SCHEMA/, `${what}: migrations create their own schema`);
  assert.match(content, /database\.CheckMigrationVersion\(db\)/, `${what}: the version check is the only gate`);
  // Not inside an `if !cfg.IsProd()` arm — development is exactly the
  // environment that used to skip it.
  assert.doesNotMatch(content, /}\s*else if err := database\.CheckMigrationVersion/, `${what}: the check runs in every environment`);
}

test("a fresh project takes its schema from migrations, in every environment", () => {
  const scratch = mkdtempSync(path.join(tmpdir(), "go-scaffold-schema-"));
  try {
    runCLI(scratch, "create", "sample", "--defaults", "--no-docker");
    assertSchemaComesFromMigrations(path.join(scratch, "sample"), "fresh create");
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
});

test("generate module, add auth and add rbac leave the schema to migrations too", () => {
  const scratch = mkdtempSync(path.join(tmpdir(), "go-scaffold-schema-incr-"));
  try {
    runCLI(scratch, "create", "sample", "--defaults", "--no-docker");
    const project = path.join(scratch, "sample");

    runCLI(project, "add", "auth", "--defaults", "--yes");
    assertSchemaComesFromMigrations(project, "after add auth");

    runCLI(project, "add", "rbac", "--yes");
    assertSchemaComesFromMigrations(project, "after add rbac");

    runCLI(project, "generate", "module", "orders", "--defaults");
    assertSchemaComesFromMigrations(project, "after generate module");

    // The module is still wired — the patch that used to add it to the
    // AutoMigrate list is the only thing that went.
    const content = wiring(project);
    assert.match(content, /order\.NewHandlerFromDB\(db\)\.Register\(api\)/);
    assert.doesNotMatch(content, /orderpostgres/, "the model import existed only for AutoMigrate");
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
});
