import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(path.dirname(path.dirname(fileURLToPath(import.meta.url))));
const CLI = path.join(ROOT, "bin", "go-scaffold.js");
const DOCS = ["README.md", "docs/architect/architecture.md", "docs/architect/techstack.md"];

function cli(cwd, ...args) {
  execFileSync("node", [CLI, ...args], { cwd, stdio: ["ignore", "pipe", "pipe"] });
}

function read(project, relativePath) {
  return readFileSync(path.join(project, relativePath), "utf8");
}

function installFeatures(project, order) {
  for (const feature of order) {
    if (feature === "auth") cli(project, "add", "auth", "--defaults", "--yes");
    if (feature === "worker") cli(project, "add", "worker", "--defaults");
    if (feature === "rbac") cli(project, "add", "rbac", "--yes");
  }
}

test("incremental auth, worker, and RBAC installation keeps project docs current", (t) => {
  const root = mkdtempSync(path.join(tmpdir(), "go-scaffold-feature-docs-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));

  const authFirstParent = path.join(root, "auth-first");
  const workerFirstParent = path.join(root, "worker-first");
  mkdirSync(authFirstParent);
  mkdirSync(workerFirstParent);
  cli(authFirstParent, "create", "app", "--defaults", "--no-docker");
  cli(workerFirstParent, "create", "app", "--defaults", "--no-docker");
  const authFirstProject = path.join(authFirstParent, "app");
  const workerFirstProject = path.join(workerFirstParent, "app");
  installFeatures(authFirstProject, ["auth", "worker", "rbac"]);
  installFeatures(workerFirstProject, ["worker", "auth", "rbac"]);

  for (const relativePath of DOCS) {
    const authFirst = read(authFirstProject, relativePath);
    const workerFirst = read(workerFirstProject, relativePath);
    assert.equal(authFirst, workerFirst, `${relativePath} should describe the resolved feature set regardless of add order`);
    assert.doesNotMatch(authFirst, /\{\{/, `${relativePath} must not contain unrendered template syntax`);
  }

  const readme = read(authFirstProject, "README.md");
  assert.match(readme, /authentication: enabled/);
  assert.match(readme, /background jobs: enabled/);
  assert.match(readme, /RBAC: enabled/);
  assert.match(readme, /├── shared\/\s+# pure logic\/framework glue/);
  assert.match(readme, /Installed optional features add the process and/);
  assert.match(read(authFirstProject, "docs/architect/techstack.md"), /Authentication and browser OAuth: `enabled`/);
  assert.match(read(authFirstProject, "docs/architect/techstack.md"), /Background worker and mail: `enabled`/);
  assert.match(read(authFirstProject, "docs/architect/techstack.md"), /RBAC roles, permissions, and authorization: `enabled`/);
});

test("incremental feature installation preserves a hand-edited README", (t) => {
  const root = mkdtempSync(path.join(tmpdir(), "go-scaffold-feature-docs-edited-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  cli(root, "create", "edited-app", "--defaults", "--no-docker");
  const project = path.join(root, "edited-app");
  const readme = path.join(project, "README.md");
  const edited = `${readFileSync(readme, "utf8")}\n## Team notes\n`;
  writeFileSync(readme, edited);

  cli(project, "add", "auth", "--defaults", "--yes");

  assert.equal(readFileSync(readme, "utf8"), edited);
  assert.match(read(project, "docs/architect/techstack.md"), /Authentication and browser OAuth: `enabled`/);
});
