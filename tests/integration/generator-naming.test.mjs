import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  existsSync,
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
      /func \(Order\) TableName\(\) string \{\s*return "order_svc\.orders"\s*\}/
    );
    assert.match(migration(project, "_create_orders.up.sql"), /CREATE TABLE order_svc\.orders/);
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
      /func \(OrderItem\) TableName\(\) string \{\s*return "orderitem_svc\.order_items"\s*\}/
    );
    // snake_case, like the table it creates — the filename used to be the
    // kebab-case route slug while everything else in the file was snake
    assert.match(
      migration(project, "_create_order_items.up.sql"),
      /CREATE TABLE orderitem_svc\.order_items/
    );
    assert.match(
      read(project, "internal/app/orderitem/handler.go"),
      /Group\("\/order-items"/
    );
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
});

// The package name on disk ("orderitem") has lost the word boundary that
// "order-items" had, and it is the one form of the name the user actually
// sees: it's the folder, and `generate module` prints it as the next command
// to run. Re-deriving the naming from it produced Orderitem/orderitems, so
// following that printed instruction emitted
// `undefined: model.Orderitem (but have OrderItem)` and undo left main.go
// referencing a package it had just deleted.
test("a multi-word module answers to its own package name", () => {
  const scratch = mkdtempSync(path.join(tmpdir(), "go-scaffold-pkgname-"));
  try {
    runCLI(scratch, "create", "sample", "--defaults", "--no-docker");
    const project = path.join(scratch, "sample");
    runCLI(project, "generate", "module", "order-items");

    // exactly what `generate module` tells you to run next
    runCLI(project, "generate", "method", "orderitem", "approve", "--type", "patch");

    const handler = read(project, "internal/app/orderitem/handler.go");
    assert.match(handler, /model\.OrderItem/);
    assert.doesNotMatch(handler, /model\.Orderitem\b/);
    assert.match(read(project, "internal/app/orderitem/service.go"), /model\.OrderItem/);
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
});

test("undo answers to the package name too, and takes the migrations with it", () => {
  const scratch = mkdtempSync(path.join(tmpdir(), "go-scaffold-pkgundo-"));
  try {
    runCLI(scratch, "create", "sample", "--defaults", "--no-docker");
    const project = path.join(scratch, "sample");
    runCLI(project, "generate", "module", "order-items");
    runCLI(project, "undo", "module", "orderitem", "-y");

    const mainGo = read(project, "cmd/api/main.go");
    assert.doesNotMatch(mainGo, /orderitem/, "main.go still references the deleted module");
    assert.equal(
      readdirSync(path.join(project, "migrations")).filter((f) => f.endsWith(".sql")).length,
      0,
      "undo left the module's migrations behind"
    );
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
});

// `vendor` is a directory name the go tool reserves, so internal/app/vendor is
// treated as a vendor directory: the project stops building with "use of
// vendored package not allowed" and "must be imported as model". The drift
// check doesn't catch it either — that compares a passing build to a failing
// one, and this breaks every package at once.
test("a module name that would create a go-reserved directory is refused", () => {
  const scratch = mkdtempSync(path.join(tmpdir(), "go-scaffold-reserved-dir-"));
  try {
    runCLI(scratch, "create", "sample", "--defaults", "--no-docker");
    const project = path.join(scratch, "sample");

    assert.throws(
      () => runCLI(project, "generate", "module", "vendors"),
      /directory name the go tool reserves/
    );
    // internal/app doesn't exist until the first module lands, so "nothing
    // was written" is either no directory at all or an empty one
    const appDir = path.join(project, "internal", "app");
    assert.equal(
      existsSync(appDir) ? readdirSync(appDir).length : 0,
      0,
      "nothing may be written when the name is refused"
    );
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
});
