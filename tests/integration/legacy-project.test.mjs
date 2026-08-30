import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(path.dirname(path.dirname(fileURLToPath(import.meta.url))));
const CLI = path.join(ROOT, "bin", "go-scaffold.js");

function run(command, args, cwd) {
  return execFileSync(command, [CLI, ...args], {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function createProject() {
  const scratch = mkdtempSync(path.join(tmpdir(), "go-scaffold-legacy-contract-"));
  run("node", ["create", "sample", "--defaults", "--no-docker"], scratch);
  return { scratch, project: path.join(scratch, "sample") };
}

test("generate module refuses to duplicate a legacy plural package", () => {
  const { scratch, project } = createProject();
  try {
    mkdirSync(path.join(project, "internal", "app", "orders"), { recursive: true });
    writeFileSync(path.join(project, "internal", "app", "orders", "legacy.go"), "package orders\n");

    assert.throws(
      () => run("node", ["generate", "module", "orders", "--full", "--defaults"], project),
      /internal\/app\/orders.*already exists/
    );
    assert.equal(existsSync(path.join(project, "internal", "app", "order")), false);
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
});

test("schema 1 projects are rejected with an explicit migration path", () => {
  const { scratch, project } = createProject();
  try {
    const configPath = path.join(project, "go-scaffold.config.json");
    const config = JSON.parse(readFileSync(configPath, "utf8"));
    config.schemaVersion = 1;
    writeFileSync(configPath, JSON.stringify(config, null, 2));

    assert.throws(
      () => run("node", ["config", "validate"], project),
      /legacy schemaVersion 1.*hexagonal split layout/
    );
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
});

test("method generation refuses an unregistered legacy module instead of patching root files", () => {
  const { scratch, project } = createProject();
  try {
    const legacyDir = path.join(project, "internal", "app", "orders");
    mkdirSync(legacyDir, { recursive: true });
    writeFileSync(path.join(legacyDir, "handler.go"), "package orders\n");

    assert.throws(
      () => run("node", ["generate", "method", "orders", "findByStatus", "--type", "get", "--get-mode", "one", "--field", "status"], project),
      /has no split-layout metadata.*go-scaffold check/
    );
    assert.equal(existsSync(path.join(project, "migrations", "20200101000000_add_orders_status.up.sql")), false);
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
});
