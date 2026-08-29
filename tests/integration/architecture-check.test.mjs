import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
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

test("check accepts service and CQRS modules in the same modular monolith", () => {
  const scratch = mkdtempSync(path.join(tmpdir(), "go-scaffold-architecture-check-"));
  try {
    run(scratch, "create", "sample", "--defaults", "--no-docker");
    const project = path.join(scratch, "sample");
    run(project, "generate", "module", "orders", "--full", "--defaults");
    run(project, "generate", "module", "tickets", "--cqrs", "--defaults");

    assert.match(run(project, "check"), /architecture check passed: 2 split module\(s\), hexagonal boundary/);
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
});

test("check rejects a service module that grows a duplicate CQRS surface", () => {
  const scratch = mkdtempSync(path.join(tmpdir(), "go-scaffold-architecture-conflict-"));
  try {
    run(scratch, "create", "sample", "--defaults", "--no-docker");
    const project = path.join(scratch, "sample");
    run(project, "generate", "module", "orders", "--full", "--defaults");
    writeFileSync(path.join(project, "internal", "app", "order", "application", "commands.go"), "package application\n");

    assert.throws(
      () => run(project, "check"),
      /service module must not contain application\/commands\.go or queries\.go/
    );
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
});

test("check rejects a feature-level model package in a split module", () => {
  const scratch = mkdtempSync(path.join(tmpdir(), "go-scaffold-architecture-model-"));
  try {
    run(scratch, "create", "sample", "--defaults", "--no-docker");
    const project = path.join(scratch, "sample");
    run(project, "generate", "module", "orders", "--full", "--defaults");
    mkdirSync(path.join(project, "internal", "app", "order", "model"));

    assert.throws(
      () => run(project, "check"),
      /feature-level model package is forbidden/
    );
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
});
