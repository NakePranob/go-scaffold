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

function read(root, relativePath) {
  return readFileSync(path.join(root, relativePath), "utf8");
}

function runGeneratedChecks(project) {
  runCLI(project, "generate", "method", "order", "approve", "--type", "patch");
  runCLI(project, "generate", "method", "order", "findByStatus", "--type", "get", "--get-mode", "one", "--field", "status");
  runCLI(project, "generate", "method", "order", "findOverdue", "--type", "get", "--get-mode", "all");

  const commands = read(project, "internal/app/order/commands.go");
  const queries = read(project, "internal/app/order/queries.go");
  const service = read(project, "internal/app/order/service.go");
  const handler = read(project, "internal/app/order/handler.go");

  assert.match(commands, /func \(h \*CommandHandler\) Approve\(/);
  assert.match(commands, /func \(h \*CommandHandler\) Create\(/);
  assert.match(commands, /func \(h \*CommandHandler\) Delete\(/);
  assert.match(queries, /func \(h \*QueryHandler\) FindByStatus\(/);
  assert.match(queries, /func \(h \*QueryHandler\) FindOverdue\(/);
  assert.match(queries, /func \(h \*QueryHandler\) List\(/);
  assert.match(service, /return s\.commands\.Approve\(/);
  assert.match(service, /return s\.queries\.FindByStatus\(/);
  assert.match(handler, /h\.commands\.Approve\(/);
  assert.match(handler, /h\.queries\.FindByStatus\(/);
  assert.match(handler, /func NewHandlerFromCQRS\(/);
  assert.match(read(project, "internal/app/order/composition.go"), /NewCommandHandler\(repo\)/);
  assert.match(read(project, "internal/app/order/composition.go"), /NewQueryHandler\(repo\)/);
  assert.match(read(project, "internal/app/order/repository.go"), /func \(r \*Repository\) FindByStatus\(/);
}

test("generate module --cqrs creates separate command/query handlers and patches each side", () => {
  const scratch = mkdtempSync(path.join(tmpdir(), "go-scaffold-cqrs-full-"));
  try {
    runCLI(scratch, "create", "sample", "--defaults", "--no-docker");
    const project = path.join(scratch, "sample");
    runCLI(project, "generate", "module", "orders", "--full", "--cqrs", "--defaults");

    assert.equal(existsSync(path.join(project, "internal/app/order/commands.go")), true);
    assert.equal(existsSync(path.join(project, "internal/app/order/queries.go")), true);
    runGeneratedChecks(project);

    execFileSync("go", ["mod", "tidy"], { cwd: project, stdio: "ignore" });
    execFileSync("go", ["test", "./..."], { cwd: project, stdio: "ignore" });
    execFileSync("go", ["vet", "./..."], { cwd: project, stdio: "ignore" });
    assert.equal(execFileSync("gofmt", ["-l", "."], { cwd: project, encoding: "utf8" }).trim(), "");
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
});

test("generate module --cqrs also works for minimal modules and command/query methods", () => {
  const scratch = mkdtempSync(path.join(tmpdir(), "go-scaffold-cqrs-minimal-"));
  try {
    runCLI(scratch, "create", "sample", "--defaults", "--no-docker");
    const project = path.join(scratch, "sample");
    runCLI(project, "generate", "module", "tickets", "--cqrs", "--defaults");
    runCLI(project, "generate", "method", "ticket", "create", "--type", "post");
    runCLI(project, "generate", "method", "ticket", "findByStatus", "--type", "get", "--get-mode", "one", "--field", "status");
    runCLI(project, "generate", "method", "ticket", "archive", "--type", "delete");

    assert.match(read(project, "internal/app/ticket/commands.go"), /func \(h \*CommandHandler\) Create\(/);
    assert.match(read(project, "internal/app/ticket/commands.go"), /func \(h \*CommandHandler\) Archive\(/);
    assert.match(read(project, "internal/app/ticket/queries.go"), /func \(h \*QueryHandler\) FindByStatus\(/);
    assert.match(read(project, "internal/app/ticket/service.go"), /import \(/);

    execFileSync("go", ["mod", "tidy"], { cwd: project, stdio: "ignore" });
    execFileSync("go", ["test", "./..."], { cwd: project, stdio: "ignore" });
    execFileSync("go", ["vet", "./..."], { cwd: project, stdio: "ignore" });
    assert.equal(execFileSync("gofmt", ["-l", "."], { cwd: project, encoding: "utf8" }).trim(), "");
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
});
