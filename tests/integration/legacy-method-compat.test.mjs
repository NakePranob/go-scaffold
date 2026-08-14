import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
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

function rewriteGoTree(dir, rewrite) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const target = path.join(dir, entry.name);
    if (entry.isDirectory()) rewriteGoTree(target, rewrite);
    else if (entry.name.endsWith(".go")) {
      writeFileSync(target, rewrite(readFileSync(target, "utf8")));
    }
  }
}

function convertToLegacyPluralModule(project) {
  const canonicalDir = path.join(project, "internal", "app", "order");
  const legacyDir = path.join(project, "internal", "app", "orders");
  renameSync(canonicalDir, legacyDir);
  rewriteGoTree(legacyDir, (source) =>
    source
      .replace(/^package order$/m, "package orders")
      .replaceAll("sample/internal/app/order/model", "sample/internal/app/orders/model")
      .replaceAll("model.Order", "model.Orders")
      .replaceAll("ErrOrder", "ErrOrders")
      .replace("type Order struct", "type Orders struct")
      .replaceAll("func (Order)", "func (Orders)")
      .replace('return "orders"', 'return "orderses"')
      .replace('Group("/orders"', 'Group("/orderses"')
  );

  const mainPath = path.join(project, "cmd", "api", "main.go");
  const legacyMain = readFileSync(mainPath, "utf8")
    .replaceAll("sample/internal/app/order", "sample/internal/app/orders")
    .replaceAll("ordermodel.Order", "ordersmodel.Orders")
    .replaceAll("ordermodel", "ordersmodel")
    .replaceAll("order.New", "orders.New")
    .replaceAll("orderRepo", "ordersRepo")
    .replaceAll("orderService", "ordersService")
    .replaceAll("orderHandler", "ordersHandler");
  writeFileSync(mainPath, legacyMain);

  const docsDir = path.join(project, "docs");
  const canonicalDocs = path.join(docsDir, "orders");
  const legacyDocs = path.join(docsDir, "orderses");
  if (existsSync(canonicalDocs)) {
    renameSync(canonicalDocs, legacyDocs);
    for (const name of readdirSync(legacyDocs)) {
      const target = path.join(legacyDocs, name);
      if (!name.endsWith(".yaml")) continue;
      writeFileSync(target, readFileSync(target, "utf8").replaceAll("Order", "Orders"));
    }
  }
  const openapiPath = path.join(docsDir, "openapi.yaml");
  if (existsSync(openapiPath)) {
    writeFileSync(
      openapiPath,
      readFileSync(openapiPath, "utf8")
        .replaceAll("/v1/orders", "/v1/orderses")
        .replaceAll("./orders/", "./orderses/")
        .replaceAll("OrderCreate", "OrdersCreate")
        .replaceAll("OrderUpdate", "OrdersUpdate")
        .replaceAll("OrderResponse", "OrdersResponse")
    );
  }

  const migrationsDir = path.join(project, "migrations");
  for (const name of readdirSync(migrationsDir)) {
    if (!name.includes("_create_orders.")) continue;
    const source = path.join(migrationsDir, name);
    const target = path.join(migrationsDir, name.replace("_create_orders.", "_create_orderses."));
    writeFileSync(target, readFileSync(source, "utf8").replaceAll("orders", "orderses"));
    rmSync(source);
  }
  return legacyDir;
}

test("generate module refuses to duplicate a legacy plural package", () => {
  const scratch = mkdtempSync(path.join(tmpdir(), "go-scaffold-legacy-duplicate-"));
  try {
    run("node", [CLI, "create", "sample", "--defaults", "--no-docker"], scratch);
    const project = path.join(scratch, "sample");
    mkdirSync(path.join(project, "internal", "app", "orders"), { recursive: true });
    writeFileSync(path.join(project, "internal", "app", "orders", "legacy.go"), "package orders\n");

    assert.throws(
      () => run("node", [CLI, "generate", "module", "orders", "--full"], project),
      /internal\/app\/orders.*already exists/
    );
    assert.equal(existsSync(path.join(project, "internal", "app", "order")), false);
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
});

test("remove module locates legacy plural packages and preserves their migrations", () => {
  const scratch = mkdtempSync(path.join(tmpdir(), "go-scaffold-legacy-remove-"));
  try {
    run("node", [CLI, "create", "sample", "--defaults", "--no-docker"], scratch);
    const project = path.join(scratch, "sample");
    run("node", [CLI, "generate", "module", "orders", "--full"], project);
    const legacyDir = convertToLegacyPluralModule(project);
    const migrationsDir = path.join(project, "migrations");
    const migrationsBefore = readdirSync(migrationsDir).filter((name) => name.includes("_create_orderses."));

    const output = run("node", [CLI, "remove", "module", "orders", "--yes"], project);

    assert.equal(existsSync(legacyDir), false);
    for (const name of migrationsBefore) assert.equal(existsSync(path.join(migrationsDir, name)), true);
    assert.doesNotMatch(readFileSync(path.join(project, "cmd", "api", "main.go"), "utf8"), /internal\/app\/orders/);
    assert.doesNotMatch(readFileSync(path.join(project, "docs", "openapi.yaml"), "utf8"), /orderses/);
    assert.match(output, /preserved migration history/);
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
});

test("generate method locates legacy plural packages and concrete handlers", () => {
  const scratch = mkdtempSync(path.join(tmpdir(), "go-scaffold-legacy-method-"));
  try {
    run("node", [CLI, "create", "sample", "--defaults", "--no-docker"], scratch);
    const project = path.join(scratch, "sample");
    run("node", [CLI, "generate", "module", "orders", "--full"], project);

    const legacyDir = convertToLegacyPluralModule(project);

    const handlerPath = path.join(legacyDir, "handler.go");
    const modernHandler = readFileSync(handlerPath, "utf8");
    const legacyHandler = modernHandler
      .replace(/type service interface \{[\s\S]*?\/\/ go-scaffold:service-interface\n\}\n\n/, "")
      .replace('\t"context"\n', "")
      .replace('\t"sample/internal/app/orders/model"\n', "")
      .replace('\t"github.com/google/uuid"\n', "")
      .replace("svc service", "svc *Service")
      .replace("func NewHandler(svc service", "func NewHandler(svc *Service");
    writeFileSync(handlerPath, legacyHandler);
    writeFileSync(path.join(legacyDir, "handler_test.go"), "package orders\n");

    const serviceTestPath = path.join(legacyDir, "service_test.go");
    writeFileSync(
      serviceTestPath,
      `package orders

import (
	"context"
	"testing"

	"sample/internal/app/orders/model"

	"github.com/google/uuid"
)

type fakeRepo struct {
	err error
	m   *model.Orders
}

func (f *fakeRepo) Create(context.Context, *model.Orders) error { return f.err }
func (f *fakeRepo) FindAll(context.Context, int, int) ([]model.Orders, error) { return nil, f.err }
func (f *fakeRepo) FindByID(context.Context, uuid.UUID) (*model.Orders, error) {
	if f.err != nil {
		return nil, f.err
	}
	return f.m, nil
}
func (f *fakeRepo) Update(context.Context, *model.Orders) error { return f.err }
func (f *fakeRepo) Delete(context.Context, uuid.UUID) error { return f.err }

// go-scaffold:fake-repo-methods

func TestGeneratedLegacyFindByStatusReturnsFixture(t *testing.T) {
	want := &model.Orders{ID: uuid.New()}
	svc := NewService(&fakeRepo{m: want})
	got, err := svc.FindByStatus(context.Background(), "active")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if got != want {
		t.Fatalf("expected legacy fake fixture %p, got %p", want, got)
	}
}
`
    );

    run(
      "node",
      [CLI, "generate", "method", "order", "findByStatus", "--type", "get", "--get-mode", "one", "--field", "status"],
      project
    );
    assert.match(
      readFileSync(serviceTestPath, "utf8"),
      /\/\/nolint:unused\nfunc \(f \*fakeRepo\) FindByStatus/
    );
    run("go", ["mod", "tidy"], project);
    run("go", ["test", "./..."], project);
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
});
