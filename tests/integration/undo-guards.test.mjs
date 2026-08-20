// The two `undo module` guards that undo-module.test.mjs doesn't reach: the
// specific regression that motivated deleting migrations at all, and the
// refusal for a package `add auth`/`add rbac` owns.
//
// The original bug this guards: `migrate version` prints the version on
// stderr and still exits 0, so reading stdout gave "", Number("") gave 0, and
// "schema_migrations is at 0" waved every applied migration straight through.
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(path.dirname(path.dirname(fileURLToPath(import.meta.url))));
const CLI = path.join(ROOT, "bin", "go-scaffold.js");

function scaffold(t) {
  const dir = mkdtempSync(path.join(tmpdir(), "gs-undo-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  execFileSync("node", [CLI, "create", "app", "--defaults"], { cwd: dir, stdio: "ignore" });
  const app = path.join(dir, "app");
  execFileSync("node", [CLI, "generate", "module", "order", "--full", "--defaults"], { cwd: app, stdio: "ignore" });
  return app;
}

function cli(app, args) {
  return execFileSync("node", [CLI, ...args], { cwd: app, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
}

function cliFails(app, args) {
  try {
    execFileSync("node", [CLI, ...args], { cwd: app, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    return null;
  } catch (err) {
    return `${err.stdout ?? ""}${err.stderr ?? ""}`;
  }
}

function migrationsOf(app) {
  return readdirSync(path.join(app, "migrations")).filter((f) => f.endsWith(".sql"));
}

// The failure this exists for: a typo'd module left its `create_oders`
// migration behind forever, and migrations/embed.go is a `//go:embed *`, so it
// then ran on every database anyone created from then on.
test("a typo'd module leaves nothing behind for the next database to pick up", (t) => {
  const app = scaffold(t);
  execFileSync("node", [CLI, "generate", "module", "oder", "--full", "--defaults"], { cwd: app, stdio: "ignore" });
  cli(app, ["undo", "module", "oder", "--yes"]);

  const left = migrationsOf(app).join(" ");
  assert.ok(!left.includes("oders"), `the typo's migration must not survive, still have: ${left}`);
  assert.ok(left.includes("orders"), "the module we kept must still have its migration");
});

function git(app, ...args) {
  execFileSync("git", ["-c", "user.email=t@t", "-c", "user.name=t", ...args], { cwd: app, stdio: "ignore" });
}

// The index alone isn't the question. A migration that was committed and later
// `git rm --cached`'d is untracked now, but it's still in history and in
// whatever anyone pulled — checking only `ls-files` let undo delete it.
test("undo refuses when a migration is only in git history, not the index", (t) => {
  const app = scaffold(t);
  git(app, "init", "-q");
  git(app, "add", "-A");
  git(app, "commit", "-qm", "init");
  git(app, "rm", "-q", "--cached", ...migrationsOf(app).map((f) => path.join("migrations", f)));

  const output = cliFails(app, ["undo", "module", "order", "--yes"]);
  assert.ok(output, "undo should have exited non-zero");
  assert.match(output, /git knows about these migrations/);
  assert.equal(migrationsOf(app).length, 2, "migrations in history must survive");
});

// Staged-but-never-committed still means it's left the working tree's sole
// custody, so the guard has to fire on the index too.
test("undo refuses when a migration is staged but not yet committed", (t) => {
  const app = scaffold(t);
  git(app, "init", "-q");
  git(app, "add", "migrations");

  const output = cliFails(app, ["undo", "module", "order", "--yes"]);
  assert.ok(output, "undo should have exited non-zero");
  assert.match(output, /git knows about these migrations/);
  assert.equal(migrationsOf(app).length, 2, "staged migrations must survive");
});

test("undo still refuses for a module that add auth/add rbac owns", (t) => {
  const app = scaffold(t);
  // no `add auth` here, so fake the shape the guard keys off: a user package
  // plus the feature flag in the config the command reads
  mkdirSync(path.join(app, "internal", "app", "user"), { recursive: true });
  writeFileSync(path.join(app, "internal", "app", "user", "handler.go"), "package user\n");
  const configPath = path.join(app, "go-scaffold.config.json");
  const config = JSON.parse(readFileSync(configPath, "utf8"));
  config.features.auth = true;
  writeFileSync(configPath, JSON.stringify(config, null, 2));

  const output = cliFails(app, ["undo", "module", "user", "--yes"]);
  assert.ok(output, "undo should have exited non-zero");
  assert.match(output, /add auth/);
  assert.ok(existsSync(path.join(app, "internal", "app", "user")), "the package must survive");
});
