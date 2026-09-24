import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(path.dirname(path.dirname(fileURLToPath(import.meta.url))));
const CLI = path.join(ROOT, "bin", "go-scaffold.js");
const run = (cwd, ...args) => execFileSync("node", [CLI, ...args], {
  cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"],
});
const config = (project) => JSON.parse(readFileSync(path.join(project, "go-scaffold.config.json"), "utf8"));

function project(t) {
  const scratch = mkdtempSync(path.join(tmpdir(), "go-scaffold-asvs-"));
  t.after(() => rmSync(scratch, { recursive: true, force: true }));
  run(scratch, "create", "app", "--defaults", "--no-docker");
  return path.join(scratch, "app");
}

for (const level of [1, 2, 3]) {
  test(`add auth records ASVS L${level} target and check reports applicable gaps`, (t) => {
    const app = project(t);
    run(app, "add", "auth", "--store", "postgres", "--browser-topology", "same-site", "--asvs-level", String(level), "--yes");
    assert.deepEqual(config(app).asvs, { version: "5.0.0", level });
    const worksheet = readFileSync(path.join(app, "docs/security/asvs-auth.md"), "utf8");
    assert.match(worksheet, new RegExp(`OWASP ASVS 5\\.0\\.0 Level ${level}`));
    assert.match(worksheet, /6\.2\.4: common passwords/);
    assert.equal(worksheet.includes("6.2.12: breached passwords"), level >= 2);
    assert.equal(worksheet.includes("phishing-resistant factor"), level >= 3);
    const output = run(app, "check");
    assert.match(output, /architecture check passed/);
    assert.match(output, new RegExp(`ASVS 5\\.0\\.0 L${level} target: unverified`));
    assert.equal(output.includes("L2: breached-password"), level >= 2);
    assert.equal(output.includes("L3: phishing-resistant"), level >= 3);
  });
}

test("--defaults resolves to L2; bad level is rejected before auth writes", (t) => {
  const app = project(t);
  assert.throws(() => run(app, "add", "auth", "--asvs-level", "4", "--defaults"), /--asvs-level must be one of/);
  assert.equal(existsSync(path.join(app, "internal/app/user")), false);
  run(app, "add", "auth", "--defaults");
  assert.deepEqual(config(app).asvs, { version: "5.0.0", level: 2 });
});

test("config and check reject an invalid or mismatched ASVS target", (t) => {
  const app = project(t);
  run(app, "add", "auth", "--defaults");
  const configPath = path.join(app, "go-scaffold.config.json");
  const current = config(app);
  current.asvs.level = 3;
  writeFileSync(configPath, JSON.stringify(current, null, 2));
  assert.throws(() => run(app, "check"), /does not match the ASVS target/);
  current.asvs.level = 2;
  writeFileSync(configPath, JSON.stringify(current, null, 2));
  rmSync(path.join(app, "docs/security/asvs-auth.md"));
  assert.throws(() => run(app, "check"), /ASVS target check failed: missing docs\/security\/asvs-auth\.md/);
  current.asvs.level = 4;
  writeFileSync(configPath, JSON.stringify(current, null, 2));
  assert.throws(() => run(app, "config", "validate"), /asvs must contain version/);
});
