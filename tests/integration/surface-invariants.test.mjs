import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
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

function fails(cwd, ...args) {
  const result = spawnSync("node", [CLI, ...args], { cwd, encoding: "utf8" });
  assert.notEqual(result.status, 0, `expected failure: ${args.join(" ")}`);
  return `${result.stdout}\n${result.stderr}`;
}

const CASES = [
  { name: "alpha", args: ["--surface", "minimal", "--defaults"], surface: "minimal" },
  { name: "bravo", args: ["--surface", "minimal", "--cqrs", "--defaults"], surface: "minimal" },
  { name: "charlie", args: ["--surface", "read", "--defaults"], surface: "read" },
  { name: "delta", args: ["--surface", "crud", "--defaults"], surface: "crud" },
  { name: "echo", args: ["--surface", "crud", "--cqrs", "--defaults"], surface: "crud" },
  { name: "foxtrot", args: ["--surface", "none", "--defaults"], surface: "none" },
  { name: "golf", args: ["--surface", "none", "--cqrs", "--defaults"], surface: "none" },
];

test("--plan writes nothing for every valid surface/style combination", () => {
  const scratch = mkdtempSync(path.join(tmpdir(), "go-scaffold-surface-plan-"));
  try {
    run(scratch, "create", "sample", "--defaults", "--no-docker");
    const project = path.join(scratch, "sample");
    for (const { name, args, surface } of CASES) {
      const plan = JSON.parse(run(project, "generate", "module", name, ...args, "--plan"));
      assert.equal(plan.writes, false, `${name} plan must not write`);
      assert.equal(plan.surface, surface, `${name} surface`);
      assert.ok(!existsSync(path.join(project, "internal", "app", name)), `${name} plan must not create the module`);
    }
    assert.match(
      fails(project, "generate", "module", "readcqrs", "--surface", "read", "--cqrs", "--defaults"),
      /read currently supports the service application style only/
    );
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
});

test("every valid surface/style combination passes check and read rejects writes", () => {
  const scratch = mkdtempSync(path.join(tmpdir(), "go-scaffold-surface-check-"));
  try {
    run(scratch, "create", "sample", "--defaults", "--no-docker");
    const project = path.join(scratch, "sample");
    for (const { name, args } of CASES) run(project, "generate", "module", name, ...args);

    assert.match(run(project, "check"), /architecture check passed: 7 split module\(s\), hexagonal boundary/);

    run(project, "generate", "method", "charlie", "list", "--type", "get", "--get-mode", "all");
    assert.match(run(project, "check"), /architecture check passed: 7 split module\(s\), hexagonal boundary/);
    assert.match(
      fails(project, "generate", "method", "charlie", "create", "--type", "post"),
      /module charlie is read-only/
    );
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
});
