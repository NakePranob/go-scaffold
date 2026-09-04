import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { appendFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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
    assert.match(readFileSync(path.join(project, "internal", "composition", "doc.go"), "utf8"), /package composition/);
    run(project, "generate", "module", "orders", "--full", "--defaults");
    run(project, "generate", "module", "tickets", "--cqrs", "--defaults");

    assert.match(run(project, "check"), /architecture check passed: 2 split module\(s\), hexagonal boundary/);
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
});

test("check accepts the RBAC role module with an HTTP DTO boundary", () => {
  const scratch = mkdtempSync(path.join(tmpdir(), "go-scaffold-architecture-rbac-"));
  try {
    run(scratch, "create", "sample", "--defaults", "--no-docker");
    const project = path.join(scratch, "sample");
    run(project, "add", "auth", "--defaults");
    run(project, "add", "rbac", "--yes");

    const applicationDTO = readFileSync(path.join(project, "internal", "app", "role", "application", "dto.go"), "utf8");
    const httpDTO = readFileSync(path.join(project, "internal", "app", "role", "adapters", "inbound", "http", "dto.go"), "utf8");
    const handler = readFileSync(path.join(project, "internal", "app", "role", "adapters", "inbound", "http", "handler.go"), "utf8");

    assert.doesNotMatch(applicationDTO, /json:/);
    assert.match(httpDTO, /type createInput struct/);
    assert.match(httpDTO, /json:"permission_codes"/);
    assert.match(handler, /var in createInput/);
    assert.match(handler, /toCreateInput\(in\)/);
    assert.match(handler, /var in setPermissionsInput/);
    assert.match(handler, /toSetPermissionsInput\(in\)/);
    assert.match(run(project, "check"), /architecture check passed: 2 split module\(s\), hexagonal boundary/);
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
});

test("check rejects a project missing the process composition package", () => {
  const scratch = mkdtempSync(path.join(tmpdir(), "go-scaffold-architecture-process-missing-"));
  try {
    run(scratch, "create", "sample", "--defaults", "--no-docker");
    const project = path.join(scratch, "sample");
    rmSync(path.join(project, "internal", "composition", "doc.go"));

    assert.throws(
      () => run(project, "check"),
      /internal\/composition\/doc\.go: required process-level composition package/
    );
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

test("check rejects a feature-level compat directory in a split module", () => {
  const scratch = mkdtempSync(path.join(tmpdir(), "go-scaffold-architecture-compat-"));
  try {
    run(scratch, "create", "sample", "--defaults", "--no-docker");
    const project = path.join(scratch, "sample");
    run(project, "generate", "module", "orders", "--full", "--defaults");
    mkdirSync(path.join(project, "internal", "app", "order", "compat"));

    assert.throws(
      () => run(project, "check"),
      /feature-level compat directory is forbidden/
    );
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
});

test("check rejects an application adapter import", () => {
  const scratch = mkdtempSync(path.join(tmpdir(), "go-scaffold-architecture-direction-"));
  try {
    run(scratch, "create", "sample", "--defaults", "--no-docker");
    const project = path.join(scratch, "sample");
    run(project, "generate", "module", "orders", "--full", "--defaults");
    writeFileSync(
      path.join(project, "internal", "app", "order", "application", "illegal.go"),
      'package application\n\nimport _ "example.com/sample/internal/app/order/adapters/outbound/postgres"\n'
    );

    assert.throws(
      () => run(project, "check"),
      /application layer imports forbidden internal layer/
    );
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
});

test("check rejects transport JSON tags in application DTOs", () => {
  const scratch = mkdtempSync(path.join(tmpdir(), "go-scaffold-architecture-json-"));
  try {
    run(scratch, "create", "sample", "--defaults", "--no-docker");
    const project = path.join(scratch, "sample");
    run(project, "generate", "module", "orders", "--full", "--defaults");
    appendFileSync(path.join(project, "internal", "app", "order", "application", "dto.go"), "\n// json: forbidden in application DTOs\n");

    assert.throws(
      () => run(project, "check"),
      /JSON tags|transport-neutral/
    );
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
});

test("check rejects composition imports from a sibling module", () => {
  const scratch = mkdtempSync(path.join(tmpdir(), "go-scaffold-architecture-composition-"));
  try {
    run(scratch, "create", "sample", "--defaults", "--no-docker");
    const project = path.join(scratch, "sample");
    run(project, "generate", "module", "orders", "--full", "--defaults");
    run(project, "generate", "module", "tickets", "--full", "--defaults");
    writeFileSync(
      path.join(project, "internal", "app", "order", "composition.go"),
      'package order\n\nimport _ "example.com/sample/internal/app/ticket/application"\n'
    );

    assert.throws(
      () => run(project, "check"),
      /composition\.go: imports sibling module ticket/
    );
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
});

test("check rejects process composition imports from a feature private package", () => {
  const scratch = mkdtempSync(path.join(tmpdir(), "go-scaffold-architecture-process-private-"));
  try {
    run(scratch, "create", "sample", "--defaults", "--no-docker");
    const project = path.join(scratch, "sample");
    run(project, "generate", "module", "orders", "--full", "--defaults");
    writeFileSync(
      path.join(project, "internal", "composition", "illegal.go"),
      'package composition\n\nimport _ "example.com/sample/internal/app/order/application"\n'
    );

    assert.throws(
      () => run(project, "check"),
      /process composition must import the public internal\/app\/order package, not private path/
    );
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
});

test("check rejects feature adapters left in cmd/api", () => {
  const scratch = mkdtempSync(path.join(tmpdir(), "go-scaffold-architecture-process-location-"));
  try {
    run(scratch, "create", "sample", "--defaults", "--no-docker");
    const project = path.join(scratch, "sample");
    run(project, "generate", "module", "orders", "--full", "--defaults");
    writeFileSync(
      path.join(project, "cmd", "api", "orders_adapter.go"),
      'package main\n\nimport _ "example.com/sample/internal/app/order"\n'
    );

    assert.throws(
      () => run(project, "check"),
      /process-level feature adapters belong in internal\/composition/
    );
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
});
