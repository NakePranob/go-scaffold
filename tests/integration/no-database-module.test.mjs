import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(path.dirname(path.dirname(fileURLToPath(import.meta.url))));
const CLI = path.join(ROOT, "bin", "go-scaffold.js");

function run(cwd, ...args) {
  return execFileSync("node", [CLI, ...args], { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
}

function fails(cwd, ...args) {
  const result = spawnSync("node", [CLI, ...args], { cwd, encoding: "utf8" });
  assert.notEqual(result.status, 0, `expected ${args.join(" ")} to fail`);
  return `${result.stdout}${result.stderr}`;
}

const read = (project, file) => readFileSync(path.join(project, file), "utf8");

// A module that owns no table — a WebSocket relay, a proxy — used to carry a
// repository port, two DTO files, and a Postgres adapter it never called,
// because check required them.
test("generate module --surface none emits no persistence and passes check", () => {
  const scratch = mkdtempSync(path.join(tmpdir(), "go-scaffold-no-database-"));
  try {
    run(scratch, "create", "hub", "--defaults", "--no-docker");
    const project = path.join(scratch, "hub");
    const migrationsBefore = readdirSync(path.join(project, "migrations")).sort();

    const output = run(project, "generate", "module", "relay", "--surface", "none", "--defaults");
    assert.match(output, /recorded module defaults: none \+ service/);
    assert.match(output, /migration: none — this module owns no table/);

    const moduleDir = "internal/app/relay";
    for (const file of [
      "composition.go",
      "domain/entity.go",
      "domain/errors.go",
      "application/service.go",
      "application/service_test.go",
      "adapters/inbound/http/handler.go",
      "adapters/inbound/http/handler_test.go",
    ]) {
      assert.ok(existsSync(path.join(project, moduleDir, file)), `expected ${file}`);
    }
    for (const absent of ["ports", "application/dto.go", "adapters/inbound/http/dto.go", "adapters/outbound"]) {
      assert.ok(!existsSync(path.join(project, moduleDir, absent)), `expected no ${absent}`);
    }
    assert.deepEqual(readdirSync(path.join(project, "migrations")).sort(), migrationsBefore);

    const composition = read(project, `${moduleDir}/composition.go`);
    assert.match(composition, /func NewHandler\(\) \*httpadapter\.Handler/);
    assert.doesNotMatch(composition, /gorm|postgres|ports/);
    assert.match(read(project, `${moduleDir}/application/service.go`), /func NewService\(\) \*Service/);
    assert.match(read(project, "cmd/api/wiring.go"), /relay\.NewHandler\(\)\.Register\(api\)/);
    assert.equal(JSON.parse(read(project, "go-scaffold.config.json")).modules.relay.surface, "none");

    const check = spawnSync("node", [CLI, "check"], { cwd: project, encoding: "utf8" });
    assert.equal(check.status, 0, check.stderr);
    assert.match(check.stdout, /architecture check passed: 1 split module/);
    assert.equal(check.stderr, "");

    // generate method writes repository calls and DTOs; say so instead of
    // reporting the module as incomplete.
    assert.match(
      fails(project, "generate", "method", "relay", "ping", "--type", "post"),
      /module relay has no database \(surface none\)/
    );

    run(project, "undo", "module", "relay", "--yes");
    assert.ok(!existsSync(path.join(project, moduleDir)));
    assert.doesNotMatch(read(project, "cmd/api/wiring.go"), /relay/);
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
});

test("--surface none combines with CQRS and can be a project default", () => {
  const scratch = mkdtempSync(path.join(tmpdir(), "go-scaffold-no-database-cqrs-"));
  try {
    run(scratch, "create", "hub", "--defaults", "--no-docker", "--module-surface", "none");
    const project = path.join(scratch, "hub");

    run(project, "generate", "module", "presence", "--surface", "none", "--cqrs", "--defaults");
    const app = "internal/app/presence/application";
    assert.match(read(project, `${app}/commands.go`), /func NewCommandHandler\(\) \*CommandHandler/);
    assert.match(read(project, `${app}/queries.go`), /func NewQueryHandler\(\) \*QueryHandler/);
    assert.ok(!existsSync(path.join(project, app, "service.go")));
    assert.match(
      read(project, "internal/app/presence/composition.go"),
      /httpadapter\.NewHandler\(application\.NewCommandHandler\(\), application\.NewQueryHandler\(\)\)/
    );

    // --defaults takes the recorded project default.
    run(project, "generate", "module", "gateway", "--defaults");
    assert.equal(JSON.parse(read(project, "go-scaffold.config.json")).modules.gateway.surface, "none");
    assert.ok(!existsSync(path.join(project, "internal/app/gateway/ports")));

    assert.match(run(project, "check"), /architecture check passed: 2 split module/);
    assert.match(fails(project, "generate", "module", "x", "--surface", "bogus", "--defaults"), /--surface must be one of: minimal, read, crud, none/);
    assert.match(fails(project, "generate", "module", "x", "--surface", "none", "--full", "--defaults"), /--surface cannot be combined with --full/);
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
});

test("generate module --surface read emits a read-only port and rejects writes", () => {
  const scratch = mkdtempSync(path.join(tmpdir(), "go-scaffold-read-surface-"));
  try {
    run(scratch, "create", "hub", "--defaults", "--no-docker");
    const project = path.join(scratch, "hub");
    const moduleDir = "internal/app/catalog";

    const output = run(project, "generate", "module", "catalog", "--surface", "read", "--defaults");
    assert.match(output, /recorded module defaults: read \+ service/);

    const ports = read(project, `${moduleDir}/ports/repository.go`);
    assert.match(ports, /FindAll\(context\.Context, ListFilter\)/);
    assert.match(ports, /FindByID\(context\.Context, uuid\.UUID\)/);
    assert.doesNotMatch(ports, /\bCreate\(|\bUpdate\(|\bDelete\(|CommandRepository|QueryRepository/);

    const adapter = read(project, `${moduleDir}/adapters/outbound/postgres/repository.go`);
    assert.match(adapter, /func \(r \*Repository\) FindAll/);
    assert.match(adapter, /func \(r \*Repository\) FindByID/);
    assert.doesNotMatch(adapter, /func \(r \*Repository\) (Create|Update|Delete)/);

    assert.equal(JSON.parse(read(project, "go-scaffold.config.json")).modules.catalog.surface, "read");

    run(project, "generate", "method", "catalog", "list", "--type", "get", "--get-mode", "all");
    assert.match(read(project, `${moduleDir}/application/method_list.go`), /func \(s \*Service\) List/);
    assert.match(fails(project, "generate", "method", "catalog", "create", "--type", "post"), /module catalog is read-only/);

    const check = spawnSync("node", [CLI, "check"], { cwd: project, encoding: "utf8" });
    assert.equal(check.status, 0, check.stderr);
    assert.match(check.stdout, /architecture check passed: 1 split module/);
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
});
