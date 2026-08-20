// `generate method --get-mode one --field <f>` writes a column migration
// named after the module's TABLE (`<version>_add_<tableName>_<column>`), not
// after the module slug the other two patterns use. `undo module` matched only
// the create and permission pairs, so that pair stayed behind: the module went,
// its create migration went, and an `ALTER TABLE <schema>.<table>` against the
// now-uncreated table remained. migrations/embed.go is a `//go:embed *`, so it
// then ran on every database made from that project and failed with
// `schema "<x>_svc" does not exist`.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(path.dirname(path.dirname(fileURLToPath(import.meta.url))));
const CLI = path.join(ROOT, "bin", "go-scaffold.js");

const cli = (cwd, ...args) =>
  execFileSync("node", [CLI, ...args], { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });

function project(t, label) {
  const dir = mkdtempSync(path.join(tmpdir(), `go-scaffold-${label}-`));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  cli(dir, "create", "app", "--defaults", "--no-docker");
  return path.join(dir, "app");
}

const sqlFiles = (app) => readdirSync(path.join(app, "migrations")).filter((f) => f.endsWith(".sql")).sort();

test("undo module takes the column migration a --field method generated", (t) => {
  const app = project(t, "undo-field");
  cli(app, "generate", "module", "orders", "--defaults");
  cli(app, "generate", "method", "orders", "findByEmail", "--type", "get", "--get-mode", "one", "--field", "email");

  assert.ok(
    sqlFiles(app).some((f) => /_add_orders_email\.up\.sql$/.test(f)),
    "precondition: the --field method writes a column migration"
  );

  cli(app, "undo", "module", "orders", "-y");
  assert.deepEqual(sqlFiles(app), [], "undo must leave no migration referencing the table it just removed");
});

// The column migration cannot be claimed on filename alone: a module whose
// table is `orders` would otherwise also match `_add_orders_logs_email...`,
// which belongs to the table `orders_logs`. Ownership is confirmed against the
// `<schema>.<table>` the file itself references.
test("undo module does not take a same-prefixed sibling's column migration", (t) => {
  const app = project(t, "undo-field-prefix");
  cli(app, "generate", "module", "orders", "--defaults");
  cli(app, "generate", "module", "orders-log", "--defaults");
  cli(app, "generate", "method", "orders-log", "findByEmail", "--type", "get", "--get-mode", "one", "--field", "email");

  const out = cli(app, "undo", "module", "orders", "-y");
  const left = sqlFiles(app);

  assert.ok(
    left.some((f) => /_add_orders_logs_email\.up\.sql$/.test(f)),
    `the sibling's column migration must survive, got: ${left.join(", ")}`
  );
  assert.ok(
    left.every((f) => !/_create_orders\.(up|down)\.sql$/.test(f)),
    "while the undone module's own create pair is gone"
  );
  assert.match(out, /left in place/, "and the ones it declined to claim are reported, not dropped silently");
});
