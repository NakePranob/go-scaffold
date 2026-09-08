import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(path.dirname(path.dirname(fileURLToPath(import.meta.url))));
const CLI = path.join(ROOT, "bin", "go-scaffold.js");

const cli = (cwd, ...args) =>
  execFileSync("node", [CLI, ...args], { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });

const read = (project, ...parts) => readFileSync(path.join(project, ...parts), "utf8");

function project(t, name) {
  const dir = mkdtempSync(path.join(tmpdir(), "go-scaffold-method-modules-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  cli(dir, "create", name, "--defaults", "--no-docker");
  return path.join(dir, name);
}

/**
 * Every verb, on both kinds of module `generate method` supports.
 *
 * The old coverage ran it on auth with `--type get` only — the one shape whose
 * body reuses a repository call and touches none of the vocabulary the two
 * modules disagree about. Everything else emitted the generated module's
 * words: `domain.ErrNotImplemented` that auth never declared, `application`
 * where auth aliases `userapp`, and `g` where auth's group is `usersGroup`.
 * Files were written, success was reported, and the project did not compile.
 */
test("generate method covers every verb on auth and on a generated module", (t) => {
  const app = project(t, "app");
  cli(app, "add", "auth", "--defaults");
  cli(app, "generate", "module", "orders", "--profile", "crud", "--defaults");

  for (const pkg of ["user", "order"]) {
    for (const type of ["post", "put", "delete"]) cli(app, "generate", "method", pkg, `${pkg}${type}`, "--type", type);
    cli(app, "generate", "method", pkg, `${pkg}All`, "--type", "get", "--get-mode", "all");
    cli(app, "generate", "method", pkg, `${pkg}One`, "--type", "get", "--get-mode", "one", "--field", "nickname");
  }

  // Each route hangs off the group its own module declared — read out of the
  // handler, not assumed, so a renamed group cannot produce `undefined: g`.
  assert.match(read(app, "internal/app/user/adapters/inbound/http/handler.go"), /usersGroup\.POST\("\/userpost"/);
  assert.match(read(app, "internal/app/order/adapters/inbound/http/handler.go"), /g\.POST\("\/orderpost"/);

  // The assertion that would have caught all of it at once.
  execFileSync("go", ["mod", "tidy"], { cwd: app, stdio: "ignore" });
  execFileSync("go", ["build", "./..."], { cwd: app, stdio: "ignore" });
  execFileSync("go", ["vet", "./..."], { cwd: app, stdio: "ignore" });
});

/**
 * A stub the CLI wrote has no body yet, and 501 says so. auth carried neither
 * the sentinel nor the mapping, so its stubs fell through to a 500 — a server
 * fault reported for a route nobody had written.
 */
test("a stub generate method wrote answers 501, not 500", (t) => {
  const app = project(t, "app");
  cli(app, "add", "auth", "--defaults");
  assert.match(read(app, "internal/app/user/domain/errors.go"), /ErrNotImplemented\s+= errors\.New/);
  assert.match(read(app, "internal/app/user/adapters/inbound/http/handler.go"), /StatusNotImplemented/);
});

/**
 * rbac is refused, and the reason is a shape rather than a name.
 *
 * Its `toDomainRole` returns a value where every other module returns a
 * pointer, and `ToRoleResponse` takes a role together with its permission
 * codes where the others take the entity. The override table can rename what
 * the patcher writes; it cannot reconcile a different signature, so the
 * command stops before writing rather than emitting code that resolves and
 * then fails to type-check.
 */
test("generate method refuses rbac, before writing anything", (t) => {
  const app = project(t, "app");
  cli(app, "add", "auth", "--defaults");
  cli(app, "add", "rbac", "--yes");

  let message = "";
  try {
    cli(app, "generate", "method", "role", "archive", "--type", "patch");
    assert.fail("expected generate method to refuse the rbac module");
  } catch (err) {
    message = String(err.stdout ?? "") + String(err.stderr ?? "") + String(err.message);
  }
  assert.match(message, /add rbac/);
  assert.match(message, /by hand/);
  assert.doesNotMatch(read(app, "internal/app/role/application/service.go"), /Archive/);
});
