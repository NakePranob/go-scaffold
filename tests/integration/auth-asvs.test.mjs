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

for (const level of [1, 2]) {
  test(`add auth generates the ASVS L${level} security profile`, (t) => {
    const app = project(t);
    run(app, "add", "auth", "--store", "postgres", "--browser-topology", "same-site", "--asvs-level", String(level), "--yes");
    assert.deepEqual(config(app).asvs, { version: "5.0.0", level });
    const worksheet = readFileSync(path.join(app, "docs/security/asvs-auth.md"), "utf8");
    assert.match(worksheet, new RegExp(`OWASP ASVS 5\\.0\\.0 Level ${level}`));
    assert.match(worksheet, /6\.2\.4: common passwords/);
    assert.equal(worksheet.includes("6.2.12: breached passwords"), level >= 2);
    const profile = readFileSync(path.join(app, "internal/app/user/application/security_profile.go"), "utf8");
    assert.match(profile, new RegExp(`Level:\\s+${level},`));
    assert.match(profile, /CommonPasswordScreening:\s+true/);
    assert.equal(/BreachedPasswordScreening:\s+true/.test(profile), level >= 2);
    const output = run(app, "check");
    assert.match(output, /architecture check passed/);
    assert.match(output, new RegExp(`ASVS 5\\.0\\.0 L${level} generated security profile: present`));
    assert.equal(output.includes("L2 production guard"), level >= 2);
    assert.match(output, /L3 is intentionally unavailable/);
  });
}

test("ASVS L3 fails closed before auth writes", (t) => {
  const app = project(t);
  assert.throws(
    () => run(app, "add", "auth", "--asvs-level", "3", "--defaults"),
    /ASVS L3 generated security profile is unavailable.*WebAuthn\/passkey/
  );
  assert.equal(existsSync(path.join(app, "internal/app/user")), false);
});

test("--defaults resolves to L2; bad level is rejected before auth writes", (t) => {
  const app = project(t);
  assert.throws(() => run(app, "add", "auth", "--asvs-level", "4", "--defaults"), /--asvs-level must be one of/);
  assert.equal(existsSync(path.join(app, "internal/app/user")), false);
  run(app, "add", "auth", "--defaults");
  assert.deepEqual(config(app).asvs, { version: "5.0.0", level: 2 });
});

test("config and check reject an invalid or mismatched ASVS profile", (t) => {
  const app = project(t);
  run(app, "add", "auth", "--defaults");
  const configPath = path.join(app, "go-scaffold.config.json");
  const current = config(app);
  current.asvs.level = 3;
  writeFileSync(configPath, JSON.stringify(current, null, 2));
  assert.throws(() => run(app, "check"), /does not match the profile/);
  current.asvs.level = 2;
  writeFileSync(configPath, JSON.stringify(current, null, 2));
  rmSync(path.join(app, "docs/security/asvs-auth.md"));
  assert.throws(() => run(app, "check"), /ASVS generated security profile check failed: missing docs\/security\/asvs-auth\.md/);
  current.asvs.level = 4;
  writeFileSync(configPath, JSON.stringify(current, null, 2));
  assert.throws(() => run(app, "config", "validate"), /asvs must contain version/);
});
