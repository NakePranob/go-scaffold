import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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

function readConfig(project) {
  return JSON.parse(readFileSync(path.join(project, "go-scaffold.config.json"), "utf8"));
}

function fails(cwd, ...args) {
  try {
    runCLI(cwd, ...args);
  } catch (error) {
    return `${error.stdout ?? ""}${error.stderr ?? ""}`;
  }
  assert.fail(`expected ${args.join(" ")} to fail`);
}

test("create records module defaults and --defaults resolves them for new modules", () => {
  const scratch = mkdtempSync(path.join(tmpdir(), "go-scaffold-config-defaults-"));
  try {
    runCLI(
      scratch,
      "create",
      "sample",
      "--defaults",
      "--no-docker",
      "--module-surface",
      "crud",
      "--application-style",
      "cqrs"
    );
    const project = path.join(scratch, "sample");
    const initial = readConfig(project);

    assert.equal(initial.schemaVersion, 2);
    assert.deepEqual(initial.architecture, {
      style: "modular-monolith",
      boundary: "hexagonal",
      packageLayout: "split",
      defaultModuleSurface: "crud",
      defaultApplicationStyle: "cqrs",
    });
    assert.deepEqual(initial.modules, {});

    const output = runCLI(project, "generate", "module", "orders", "--defaults");
    const config = readConfig(project);

    assert.match(output, /recorded module defaults: crud \+ cqrs/);
    assert.match(readFileSync(path.join(project, "internal/app/order/adapters/inbound/http/handler.go"), "utf8"), /g\.POST\(/);
    assert.match(readFileSync(path.join(project, "internal/app/order/application/commands.go"), "utf8"), /CommandHandler/);
    assert.deepEqual(config.modules.order, {
      surface: "crud",
      applicationStyle: "cqrs",
      boundary: "hexagonal",
      packageLayout: "split",
    });

    runCLI(project, "config", "validate");
    assert.match(runCLI(project, "config", "show"), /"defaultApplicationStyle": "cqrs"/);

    runCLI(project, "undo", "module", "order", "-y");
    assert.deepEqual(readConfig(project).modules, {});
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
});

test("legacy config without architecture metadata resolves safe defaults", () => {
  const scratch = mkdtempSync(path.join(tmpdir(), "go-scaffold-config-legacy-"));
  try {
    runCLI(scratch, "create", "sample", "--defaults", "--no-docker");
    const project = path.join(scratch, "sample");
    const configPath = path.join(project, "go-scaffold.config.json");
    const config = readConfig(project);
    delete config.schemaVersion;
    delete config.architecture;
    delete config.modules;
    writeFileSync(configPath, JSON.stringify(config, null, 2));

    assert.match(runCLI(project, "config", "validate"), /valid go-scaffold\.config\.json \(schema 2\)/);
    const resolved = JSON.parse(runCLI(project, "config", "show"));
    assert.deepEqual(resolved.architecture, {
      style: "modular-monolith",
      boundary: "hexagonal",
      packageLayout: "split",
      defaultModuleSurface: "minimal",
      defaultApplicationStyle: "service",
    });
    assert.deepEqual(resolved.modules, {});
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
});

test("config validate rejects unsupported generation combinations", () => {
  const scratch = mkdtempSync(path.join(tmpdir(), "go-scaffold-config-invalid-"));
  try {
    runCLI(scratch, "create", "sample", "--defaults", "--no-docker");
    const project = path.join(scratch, "sample");
    const configPath = path.join(project, "go-scaffold.config.json");
    const config = readConfig(project);
    config.architecture.defaultApplicationStyle = "events";
    writeFileSync(configPath, JSON.stringify(config, null, 2));

    assert.match(
      fails(project, "config", "validate"),
      /go-scaffold\.config\.json\.architecture\.defaultApplicationStyle must be one of: service, cqrs/
    );
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
});

test("named module profiles resolve to supported architecture combinations", () => {
  const scratch = mkdtempSync(path.join(tmpdir(), "go-scaffold-config-profiles-"));
  try {
    runCLI(scratch, "create", "sample", "--defaults", "--no-docker", "--module-profile", "crud");
    const project = path.join(scratch, "sample");
    assert.deepEqual(readConfig(project).architecture, {
      style: "modular-monolith",
      boundary: "hexagonal",
      packageLayout: "split",
      defaultModuleSurface: "crud",
      defaultApplicationStyle: "service",
    });

    const output = runCLI(project, "generate", "module", "tickets", "--profile", "cqrs", "--defaults");
    assert.match(output, /recorded module defaults: minimal \+ cqrs/);
    assert.match(readFileSync(path.join(project, "internal/app/ticket/application/commands.go"), "utf8"), /CommandHandler/);
    assert.deepEqual(readConfig(project).modules.ticket, {
      surface: "minimal",
      applicationStyle: "cqrs",
      boundary: "hexagonal",
      packageLayout: "split",
    });

    assert.match(
      fails(project, "generate", "module", "orders", "--profile", "lean", "--full", "--defaults"),
      /--profile cannot be combined with --full, --no-full, or --cqrs/
    );
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
});
