import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
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

test("create writes http-contract.json and contract export reads it", () => {
  const scratch = mkdtempSync(path.join(tmpdir(), "go-scaffold-contract-"));
  try {
    run(scratch, "create", "acme", "--defaults", "--no-docker", "--http-preset", "envelope");
    const project = path.join(scratch, "acme");
    const file = path.join(project, "http-contract.json");
    assert.ok(existsSync(file), "create must write http-contract.json");

    const artifact = JSON.parse(readFileSync(file, "utf8"));
    assert.equal(artifact.schemaVersion, 1);
    assert.equal(artifact.preset, "envelope");
    assert.equal(artifact.resolved.single, "data");
    assert.match(artifact.presetHash, /^sha256:/);

    const exported = JSON.parse(run(project, "contract", "export", "--json"));
    assert.deepEqual(exported, artifact);

    const out = path.join(scratch, "exported.json");
    run(project, "contract", "export", "--out", out);
    assert.deepEqual(JSON.parse(readFileSync(out, "utf8")), artifact);
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
});
