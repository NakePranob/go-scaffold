import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
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

test("check does not mistake a project name containing redis for a Redis import", () => {
  const scratch = mkdtempSync(path.join(tmpdir(), "go-scaffold-architecture-redis-name-"));
  try {
    run(scratch, "create", "auditredis", "--defaults", "--no-docker");
    const project = path.join(scratch, "auditredis");
    run(project, "generate", "module", "orders", "--profile", "crud", "--defaults");
    assert.match(run(project, "check"), /architecture check passed: 1 split module/);

    const illegal = path.join(project, "internal", "app", "order", "application", "illegal.go");
    writeFileSync(illegal, 'package application\n\nimport _ "github.com/redis/go-redis/v9"\n');
    assert.throws(() => run(project, "check"), /application layer imports forbidden dependency github\.com\/redis\/go-redis\/v9/);
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

test("check accepts an external test package beside composition.go, and still rejects implementation", () => {
  const scratch = mkdtempSync(path.join(tmpdir(), "go-scaffold-architecture-root-test-"));
  try {
    run(scratch, "create", "sample", "--defaults", "--no-docker");
    const project = path.join(scratch, "sample");
    run(project, "generate", "module", "orders", "--full", "--defaults");
    const moduleDir = path.join(project, "internal", "app", "order");

    // The only place Go lets you test a composition root end to end. It is
    // imported by nothing and adds no dependency edge.
    writeFileSync(
      path.join(moduleDir, "composition_test.go"),
      'package order_test\n\nimport (\n\t"testing"\n\n\t_ "example.com/sample/internal/app/order"\n)\n\nfunc TestComposes(t *testing.T) {}\n'
    );
    assert.doesNotThrow(() => run(project, "check"));

    // A second implementation file in the same package is still a breach —
    // that is what the rule is for.
    writeFileSync(path.join(moduleDir, "helpers.go"), "package order\n");
    assert.throws(() => run(project, "check"), /root module package may only contain composition\.go/);
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
});

// A check that only reads adapters/inbound/http lets a second transport carry
// any import it likes. Every folder under adapters/inbound is the inbound
// layer; outbound already worked this way and stays covered here.
test("check applies layer rules to every adapter folder, not only inbound/http", () => {
  const scratch = mkdtempSync(path.join(tmpdir(), "go-scaffold-architecture-adapters-"));
  try {
    run(scratch, "create", "sample", "--defaults", "--no-docker");
    const project = path.join(scratch, "sample");
    run(project, "generate", "module", "orders", "--profile", "lean", "--defaults");
    run(project, "generate", "module", "tickets", "--profile", "lean", "--defaults");
    const moduleDir = path.join(project, "internal", "app", "order");
    const write = (relative, content) => {
      mkdirSync(path.dirname(path.join(moduleDir, relative)), { recursive: true });
      writeFileSync(path.join(moduleDir, relative), content);
    };

    write("adapters/inbound/ws/ws.go", 'package ws\n\nimport _ "gorm.io/gorm"\n');
    assert.throws(() => run(project, "check"), /adapters\/inbound\/ws\/ws\.go: inbound layer imports forbidden dependency gorm\.io\/gorm/);

    write("adapters/inbound/ws/ws.go", 'package ws\n\nimport _ "example.com/sample/internal/app/ticket"\n');
    assert.throws(() => run(project, "check"), /adapters\/inbound\/ws\/ws\.go: imports sibling module ticket/);

    write("adapters/inbound/ws/ws.go", 'package ws\n\nimport _ "example.com/sample/internal/app/order/adapters/outbound/postgres"\n');
    assert.throws(() => run(project, "check"), /adapters\/inbound\/ws\/ws\.go: inbound layer imports forbidden internal layer/);

    write("adapters/inbound/ws/ws.go", 'package ws\n\nimport _ "github.com/gin-gonic/gin"\n');
    write("adapters/outbound/memory/presence.go", 'package memory\n\nimport _ "github.com/gin-gonic/gin"\n');
    assert.throws(() => run(project, "check"), /adapters\/outbound\/memory\/presence\.go: outbound layer imports forbidden dependency github\.com\/gin-gonic\/gin/);
    rmSync(path.join(moduleDir, "adapters", "outbound", "memory"), { recursive: true });

    // A folder outside every layer passes, but is named so it cannot hide,
    // and the sibling-module rule still reaches it.
    write("adapters/kafka/consumer.go", "package kafka\n");
    const output = execFileSync("node", [CLI, "check"], { cwd: project, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    assert.match(output, /architecture check passed/);
    const warned = execFileSync("sh", ["-c", `node "${CLI}" check 2>&1 >/dev/null`], { cwd: project, encoding: "utf8" });
    assert.match(warned, /internal\/app\/order\/adapters\/kafka: not a layer check knows/);
    write("adapters/kafka/consumer.go", 'package kafka\n\nimport _ "example.com/sample/internal/app/ticket"\n');
    assert.throws(() => run(project, "check"), /adapters\/kafka\/consumer\.go: imports sibling module ticket/);
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
});

// The forbidden-package patterns used to end in `\/`, so they matched
// `internal/shared/tx/sub` but not `internal/shared/tx` — the package itself,
// which is the import anyone actually writes.
test("check rejects a forbidden shared package imported by its exact path", () => {
  const scratch = mkdtempSync(path.join(tmpdir(), "go-scaffold-architecture-exact-import-"));
  try {
    run(scratch, "create", "sample", "--defaults", "--no-docker");
    const project = path.join(scratch, "sample");
    run(project, "generate", "module", "orders", "--profile", "crud", "--defaults");
    const moduleDir = path.join(project, "internal", "app", "order");
    const cases = [
      ["application/illegal.go", "package application", "internal/shared/apperror", "application"],
      ["application/illegal.go", "package application", "internal/shared/middleware", "application"],
      ["ports/illegal.go", "package ports", "internal/shared/tx", "ports"],
      ["ports/illegal.go", "package ports", "internal/platform", "ports"],
      ["adapters/outbound/postgres/illegal.go", "package postgres", "internal/shared/middleware", "outbound"],
      ["adapters/outbound/postgres/illegal.go", "package postgres", "internal/shared/httpx", "outbound"],
      ["domain/illegal.go", "package domain", "internal/shared", "domain"],
    ];
    for (const [file, pkg, imported, layer] of cases) {
      writeFileSync(path.join(moduleDir, file), `${pkg}\n\nimport _ "example.com/sample/${imported}"\n`);
      assert.throws(
        () => run(project, "check"),
        new RegExp(`${layer} layer imports forbidden dependency example\\.com/sample/${imported.replaceAll("/", "\\/")}(?:\\n|$)`),
        `${file} importing ${imported}`
      );
      rmSync(path.join(moduleDir, file));
    }

    // The boundary is a path segment: a package that merely starts with a
    // forbidden name is somebody else's package.
    writeFileSync(path.join(moduleDir, "application", "fine.go"), 'package application\n\nimport _ "example.com/sample/internal/shared/txlog"\n');
    assert.match(run(project, "check"), /architecture check passed/);
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
});

// check got stricter; a project generated today must not notice. Every module
// profile, both auth features, and their adapter folders pass with no warning.
test("check passes every freshly generated profile with no warnings", () => {
  const scratch = mkdtempSync(path.join(tmpdir(), "go-scaffold-architecture-profiles-"));
  try {
    run(scratch, "create", "sample", "--defaults", "--no-docker");
    const project = path.join(scratch, "sample");
    run(project, "add", "auth", "--defaults");
    run(project, "add", "rbac", "--yes");
    run(project, "generate", "module", "leans", "--profile", "lean", "--defaults");
    run(project, "generate", "module", "cruds", "--profile", "crud", "--defaults");
    run(project, "generate", "module", "queries", "--profile", "cqrs", "--defaults");
    run(project, "generate", "module", "mixes", "--full", "--cqrs", "--defaults");
    run(project, "generate", "module", "relays", "--surface", "none", "--defaults");
    run(project, "generate", "module", "streams", "--surface", "none", "--cqrs", "--defaults");
    run(project, "generate", "module", "guards", "--surface", "none", "--auth", "--permission", "guards:use", "--defaults");

    const result = spawnSync("node", [CLI, "check"], { cwd: project, encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /architecture check passed: 9 split module\(s\)/);
    assert.equal(result.stderr, "");
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
});
