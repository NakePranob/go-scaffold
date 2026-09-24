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
  return execFileSync("node", [CLI, ...args], { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
}

function scratchProject(t, name) {
  const scratch = mkdtempSync(path.join(tmpdir(), `go-scaffold-${name}-`));
  t.after(() => rmSync(scratch, { recursive: true, force: true }));
  runCLI(scratch, "create", "sample", "--defaults", "--no-docker");
  return path.join(scratch, "sample");
}

const read = (project, ...segments) => readFileSync(path.join(project, ...segments), "utf8");

// A freshly created project has no go.sum yet, so anything that compiles it
// has to resolve the module graph first.
const go = (project, ...args) => execFileSync("go", args, { cwd: project, stdio: "ignore" });

// The escaping is the whole reason dbq exists: without it a search for "50%"
// matches every row, which is a filter that silently does nothing.
test("create ships the search helper and its own test", (t) => {
  const project = scratchProject(t, "list-shared");

  assert.equal(existsSync(path.join(project, "internal", "shared", "dbq", "dbq.go")), true);
  const pagination = read(project, "internal", "shared", "pagination", "pagination.go");
  assert.match(pagination, /Search string/);
  assert.match(pagination, /c\.Query\("q"\)/);
  // The order is parsed in the same place as the page, so every list spells
  // it the same way.
  assert.match(pagination, /c\.Query\("sort"\)/);
  assert.match(pagination, /c\.Query\("order"\) == "desc"/);

  // ORDER BY takes no bound parameter, so the name off the request is resolved
  // against a whitelist instead of being interpolated.
  const dbq = read(project, "internal", "shared", "dbq", "dbq.go");
  assert.match(dbq, /type Sort struct/);
  assert.match(dbq, /func \(s Sort\) OrderBy\(sort string, desc bool\) string/);

  // dbq_test.go builds SQL with a dry-run session, so it needs no database and
  // runs wherever `go test ./...` does.
  go(project, "mod", "tidy");
  go(project, "test", "./internal/shared/...");
});

test("a crud module lists through one filter struct and answers a total", (t) => {
  const project = scratchProject(t, "list-crud");
  runCLI(project, "generate", "module", "invoices", "--profile", "crud");

  const ports = read(project, "internal", "app", "invoice", "ports", "repository.go");
  assert.match(ports, /type ListFilter struct/);
  assert.match(ports, /FindAll\(context\.Context, ListFilter\) \(\[\]domain\.Invoice, int64, error\)/);

  const repository = read(project, "internal", "app", "invoice", "adapters", "outbound", "postgres", "repository.go");
  assert.match(repository, /dbq\.Search\(q, filter\.Search/);
  // The count must not be taken from the query that carries the page's LIMIT.
  assert.match(repository, /matching\(\)\.Count\(&total\)/);
  // A page without a tiebreaker can show one row twice and hide another, and
  // the default order is the one dbq.Sort falls back to.
  assert.match(repository, /var sortable = dbq\.Sort\{/);
  assert.match(repository, /Default:\s+"created_at desc"/);
  assert.match(repository, /Tiebreak:\s+"id"/);
  assert.match(repository, /sortable\.OrderBy\(filter\.Sort, filter\.Desc\)/);

  const handler = read(project, "internal", "app", "invoice", "adapters", "inbound", "http", "handler.go");
  assert.match(handler, /ports\.ListFilter\{[\s\S]*Search: p\.Search/);
  assert.match(handler, /Sort:\s+p\.Sort/);
  assert.match(handler, /Desc:\s+p\.Desc/);
  assert.match(handler, /p\.ResponseWithTotal\(out, total\)/);

  go(project, "mod", "tidy");
  go(project, "test", "./...");
});

// A method patched into an existing module has to speak the same contract the
// module was generated with, or the project stops compiling.
test("generate method --get-mode all patches in the same filter contract", (t) => {
  const project = scratchProject(t, "list-method");
  runCLI(project, "generate", "module", "invoices", "--profile", "crud");
  runCLI(project, "generate", "method", "invoice", "overdue", "--type", "get", "--get-mode", "all");

  const handler = read(project, "internal", "app", "invoice", "adapters", "inbound", "http", "handler.go");
  assert.match(handler, /func \(h \*Handler\) overdue\(c \*gin\.Context\) \{[\s\S]*ports\.ListFilter\{[\s\S]*Sort:\s+p\.Sort/);
  assert.match(handler, /items, total, err := h\.svc\.Overdue\(c\.Request\.Context\(\), filter\)/);

  const service = read(project, "internal", "app", "invoice", "application", "service.go");
  assert.match(service, /Overdue\(context\.Context, ports\.ListFilter\) \(\[\]domain\.Invoice, int64, error\)/);

  go(project, "mod", "tidy");
  go(project, "build", "./...");
});

// add auth and add rbac own their own list endpoints; they must not drift into
// a second, older list contract that generate method cannot patch.
test("the auth and rbac lists use the same filter contract", (t) => {
  const project = scratchProject(t, "list-auth");
  runCLI(project, "add", "auth", "--store", "postgres", "--yes");
  runCLI(project, "add", "rbac", "--yes");

  const userPorts = read(project, "internal", "app", "user", "ports", "repository.go");
  assert.match(userPorts, /FindAll\(context\.Context, ListFilter\) \(\[\]domain\.User, int64, error\)/);
  const rolePorts = read(project, "internal", "app", "role", "ports", "repository.go");
  assert.match(rolePorts, /FindAll\(context\.Context, ListFilter\) \(\[\]domain\.Role, int64, error\)/);
  const roleRepository = read(project, "internal", "app", "role", "adapters", "outbound", "postgres", "repository.go");
  assert.match(roleRepository, /dbq\.Search\(q, filter\.Search, "code", "name"\)/);

  // The admin user list is the one generated screen that sorts, so it names
  // the columns it accepts rather than leaving the map for an engineer.
  const userRepository = read(project, "internal", "app", "user", "adapters", "outbound", "postgres", "repository.go");
  assert.match(userRepository, /var sortable = dbq\.Sort\{/);
  assert.match(userRepository, /"name":\s+"name"/);
  assert.match(userRepository, /sortable\.OrderBy\(filter\.Sort, filter\.Desc\)/);
  const userHandler = read(project, "internal", "app", "user", "adapters", "inbound", "http", "handler.go");
  assert.match(userHandler, /Sort:\s+p\.Sort/);

  go(project, "mod", "tidy");
  go(project, "test", "./...");
});
