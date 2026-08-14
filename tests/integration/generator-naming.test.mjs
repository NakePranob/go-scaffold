import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
} from "node:fs";
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

function migration(root, suffix) {
  const filename = readdirSync(path.join(root, "migrations")).find((entry) =>
    entry.endsWith(suffix)
  );
  assert.ok(filename, `missing migration ending with ${suffix}`);
  return read(root, path.join("migrations", filename));
}

test("plural module input produces a singular entity with one explicit table name", () => {
  const scratch = mkdtempSync(path.join(tmpdir(), "go-scaffold-naming-"));
  try {
    runCLI(scratch, "create", "sample", "--defaults", "--no-docker");
    const project = path.join(scratch, "sample");
    runCLI(project, "generate", "module", "orders");

    const model = read(project, "internal/app/order/model/model.go");
    assert.match(model, /type Order struct/);
    assert.match(
      model,
      /func \(Order\) TableName\(\) string \{\s*return "orders"\s*\}/
    );
    assert.match(migration(project, "_create_orders.up.sql"), /CREATE TABLE orders/);
    assert.match(read(project, "internal/app/order/handler.go"), /Group\("\/orders"/);
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
});

test("multi-word module keeps URL words and uses snake_case SQL identifiers", () => {
  const scratch = mkdtempSync(path.join(tmpdir(), "go-scaffold-multiword-"));
  try {
    runCLI(scratch, "create", "sample", "--defaults", "--no-docker");
    const project = path.join(scratch, "sample");
    runCLI(project, "generate", "module", "order-items");

    const model = read(project, "internal/app/orderitem/model/model.go");
    assert.match(model, /type OrderItem struct/);
    assert.match(
      model,
      /func \(OrderItem\) TableName\(\) string \{\s*return "order_items"\s*\}/
    );
    assert.match(
      migration(project, "_create_order-items.up.sql"),
      /CREATE TABLE order_items/
    );
    assert.match(
      read(project, "internal/app/orderitem/handler.go"),
      /Group\("\/order-items"/
    );
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
});
