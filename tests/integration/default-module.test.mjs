import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
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

test("generate module defaults to a safe minimal module", () => {
  const scratch = mkdtempSync(path.join(tmpdir(), "go-scaffold-default-module-"));
  try {
    runCLI(scratch, "create", "sample", "--defaults", "--no-docker");
    const project = path.join(scratch, "sample");

    const output = runCLI(project, "generate", "module", "orders", "--defaults");
    const handler = readFileSync(
      path.join(project, "internal", "app", "order", "adapters", "inbound", "http", "handler.go"),
      "utf8"
    );

    assert.match(output, /registered empty route group/);
    assert.doesNotMatch(handler, /g\.POST\(/);
    assert.equal(existsSync(path.join(project, "docs", "orders")), false);

    const legacyOutput = runCLI(project, "generate", "module", "widgets", "--no-full", "--defaults");
    const legacyHandler = readFileSync(
      path.join(project, "internal", "app", "widget", "adapters", "inbound", "http", "handler.go"),
      "utf8"
    );
    assert.match(legacyOutput, /registered empty route group/);
    assert.doesNotMatch(legacyHandler, /g\.POST\(/);
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
});
