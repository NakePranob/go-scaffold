import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(path.dirname(path.dirname(fileURLToPath(import.meta.url))));
const CLI = path.join(ROOT, "bin", "go-scaffold.js");

function run(command, args, cwd) {
  return execFileSync(command, args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function read(project, relativePath) {
  return readFileSync(path.join(project, relativePath), "utf8");
}

test("generated modules have scalable service and handler unit-test seams", () => {
  const scratch = mkdtempSync(path.join(tmpdir(), "go-scaffold-unit-seams-"));
  try {
    run("node", [CLI, "create", "sample", "--defaults", "--no-docker", "--api-prefix", "v1"], scratch);
    const project = path.join(scratch, "sample");
    run("node", [CLI, "generate", "module", "orders", "--full", "--defaults"], project);

    const handler = read(project, "internal/app/order/handler.go");
    assert.match(handler, /type service interface \{/);
    assert.match(handler, /svc service/);
    assert.doesNotMatch(handler, /svc \*Service/);
    assert.match(handler, /Create\(context\.Context, createInput\)/);
    assert.match(handler, /Update\(context\.Context, uuid\.UUID, updateInput\)/);

    const service = read(project, "internal/app/order/service.go");
    assert.match(service, /Create\(ctx context\.Context, in createInput\)/);
    assert.match(service, /Update\(ctx context\.Context, id uuid\.UUID, in updateInput\)/);

    const serviceTest = read(project, "internal/app/order/service_test.go");
    assert.match(serviceTest, /type repositoryStub struct/);
    assert.match(serviceTest, /createFn\s+func/);
    assert.match(serviceTest, /findByIDFn\s+func/);
    assert.match(serviceTest, /updateFn\s+func/);
    assert.doesNotMatch(serviceTest, /type fakeRepo struct/);

    const handlerTest = read(project, "internal/app/order/handler_test.go");
    assert.match(handlerTest, /type serviceStub struct/);
    assert.match(handlerTest, /createFn\s+func/);
    assert.doesNotMatch(handlerTest, /gorm\.io\/driver\/postgres/);
    assert.doesNotMatch(handlerTest, /TEST_DB_DSN/);

    const repositoryTest = read(project, "internal/app/order/repository_test.go");
    assert.match(repositoryTest, /REQUIRE_TEST_DB/);
    assert.match(repositoryTest, /TEST_DB_DSN/);
    assert.doesNotMatch(repositoryTest, /AutoMigrate/);
    assert.doesNotMatch(repositoryTest, /DropTable/);

    const ci = read(project, ".github/workflows/ci.yml");
    assert.match(ci, /migrate -path migrations/);
    assert.match(ci, /REQUIRE_TEST_DB: "true"/);
    assert.match(ci, /TEST_DB_DSN:/);

    const itemDocs = read(project, "docs/orders/item.yaml");
    const deleteContract = itemDocs.slice(itemDocs.indexOf("delete:"));
    assert.doesNotMatch(deleteContract, /"404"/);

    run("node", [CLI, "generate", "method", "orders", "approve", "--type", "patch"], project);
    const openapi = read(project, "docs/openapi.yaml");
    assert.match(openapi, /\/v1\/orders\/\{id\}\/approve:/);
    const approveDocs = read(project, "docs/orders/methods/approve.yaml");
    assert.match(approveDocs, /^parameters:/);
    assert.match(approveDocs, /^patch:/m);
    assert.match(approveDocs, /operationId: approveOrder/);
    assert.doesNotMatch(approveDocs, /requestBody:/);

    run("node", [CLI, "generate", "method", "orders", "submit", "--type", "post"], project);
    const submitDocs = read(project, "docs/orders/methods/submit.yaml");
    assert.doesNotMatch(submitDocs, /^parameters:/);
    assert.doesNotMatch(submitDocs, /in: path/);
    assert.match(submitDocs, /^post:/m);
    assert.match(submitDocs, /requestBody:/);

    run("go", ["mod", "tidy"], project);
    run("go", ["test", "./..."], project);
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
});
