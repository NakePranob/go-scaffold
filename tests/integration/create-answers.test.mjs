import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(path.dirname(path.dirname(fileURLToPath(import.meta.url))));
const CLI = path.join(ROOT, "bin", "go-scaffold.js");

function run(cwd, ...args) {
  return execFileSync("node", [CLI, ...args], {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

test("create --answers --plan writes nothing and --apply freezes the preset", () => {
  const scratch = mkdtempSync(path.join(tmpdir(), "go-scaffold-answers-"));
  try {
    const answers = path.join(scratch, "answers.json");
    writeFileSync(answers, JSON.stringify({
      "project.name": "acme-shop",
      "project.goModule": "github.com/acme/shop",
      "features.docker": false,
      "features.openapiDocs": true,
      "features.observability": false,
      "apiPrefix": "v1",
      "http.preset": "envelope",
      "architecture.moduleProfile": "crud",
    }, null, 2));

    const plan = JSON.parse(run(scratch, "create", "--answers", answers, "--plan"));
    assert.equal(plan.writes, false);
    assert.equal(plan.http.preset, "envelope");
    assert.equal(plan.http.resolved.single, "data");
    assert.ok(!existsSync(path.join(scratch, "acme-shop")), "plan must not create the project");

    run(scratch, "create", "--answers", answers, "--apply");
    const project = path.join(scratch, "acme-shop");
    const config = JSON.parse(readFileSync(path.join(project, "go-scaffold.config.json"), "utf8"));
    assert.equal(config.schemaVersion, 3);
    assert.equal(config.http.preset, "envelope");
    assert.equal(config.http.resolved.list, "data-meta");
    assert.match(config.http.presetHash, /^sha256:/);
    assert.equal(config.goModule, "github.com/acme/shop");
    assert.match(run(project, "check"), /http contract: envelope/);
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
});
