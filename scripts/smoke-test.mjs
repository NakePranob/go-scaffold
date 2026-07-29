#!/usr/bin/env node
// End-to-end smoke test for the go-scaffold CLI: exercises create + generate
// module (full and minimal) + generate method against a real Go toolchain in
// a scratch directory, and checks the guard rails (bad names, duplicates,
// forbidden flags) actually reject. No Postgres required — integration
// tests inside the generated project skip gracefully if the DB isn't up,
// the same behavior the CLI itself scaffolds for every project.
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, existsSync, readFileSync, readdirSync, writeFileSync, writeSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const CLI = path.join(ROOT, "bin", "go-scaffold.js");

let passed = 0;
let scratch;

function step(name, fn) {
  process.stdout.write(`- ${name} ... `);
  try {
    fn();
    console.log("ok");
    passed++;
  } catch (err) {
    console.log("FAILED");
    // console.error + process.exit() can race: stderr isn't a TTY when output is
    // piped/redirected (every way this script actually gets run — CI, `pnpm run
    // verify`, a log file), so the write can still be buffered when exit() tears
    // the process down, silently dropping the one line that explains the failure.
    // writeSync is synchronous, so it's flushed before exit() runs.
    const detail = err.stdout?.toString() || err.stderr?.toString() || err.message;
    writeSync(2, `${detail}\n`);
    cleanup();
    process.exit(1);
  }
}

function run(cmd, args, cwd, env) {
  return execFileSync(cmd, args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    env: env ? { ...process.env, ...env } : process.env,
  });
}

function goScaffold(args, cwd) {
  return run("node", [CLI, ...args], cwd);
}

function expectThrows(fn, messageFragment) {
  try {
    fn();
  } catch (err) {
    const msg = (err.stdout?.toString() ?? "") + (err.stderr?.toString() ?? "") + err.message;
    if (!msg.includes(messageFragment)) {
      throw new Error(`expected error containing "${messageFragment}", got: ${msg}`);
    }
    return;
  }
  throw new Error(`expected an error containing "${messageFragment}", but it succeeded`);
}

function assertFileContains(filePath, needle) {
  if (!existsSync(filePath)) throw new Error(`missing file: ${filePath}`);
  const content = readFileSync(filePath, "utf8");
  if (!content.includes(needle)) throw new Error(`${filePath} doesn't contain "${needle}"`);
}

function cleanup() {
  if (scratch && existsSync(scratch)) rmSync(scratch, { recursive: true, force: true });
}

if (!existsSync(path.join(ROOT, "dist", "index.js"))) {
  console.error("dist/index.js missing — run `pnpm run build` first");
  process.exit(1);
}
try {
  run("go", ["version"]);
} catch {
  console.error("no Go toolchain on PATH — required for the smoke test");
  process.exit(1);
}

scratch = mkdtempSync(path.join(tmpdir(), "go-scaffold-smoke-"));
console.log(`scratch dir: ${scratch}\n`);

step("rejects an invalid project name before writing anything", () => {
  expectThrows(() => goScaffold(["create", "My Cool App", "--defaults"], scratch), "invalid project name");
});

step("create --defaults scaffolds a bare project", () => {
  goScaffold(["create", "full-app", "--defaults"], scratch);
  assertFileContains(path.join(scratch, "full-app", "go.mod"), "module full-app");
});

const fullApp = path.join(scratch, "full-app");
step("bare project: go mod tidy + build + vet", () => {
  run("go", ["mod", "tidy"], fullApp);
  run("go", ["build", "./..."], fullApp);
  run("go", ["vet", "./..."], fullApp);
});

let hasDocker = true;
try {
  run("docker", ["--version"]);
} catch {
  hasDocker = false;
}

// docker port prints one line per protocol family ("0.0.0.0:PORT" and
// "[::]:PORT") for an ephemeral (-p 0:CONTAINER_PORT) mapping — both name the
// same host port, so the last field after splitting on ":" is it regardless
// of which line answers first.
function readMappedPort(containerId) {
  const portMap = run("docker", ["port", containerId, "6379/tcp"]).trim();
  return portMap.split(":").pop();
}

// polls a localhost TCP port via bash's /dev/tcp (no netcat/redis-cli
// dependency on the host) — used to wait out the gap between `docker start`
// returning and the host-mapped port actually accepting connections again.
function waitForPort(port, attempts = 30) {
  for (let i = 0; i < attempts; i++) {
    try {
      run("bash", ["-c", `echo > /dev/tcp/127.0.0.1/${port}`]);
      return;
    } catch {
      run("sleep", ["0.3"]);
    }
  }
  throw new Error(`port ${port} never accepted a connection`);
}

// `add worker` end to end: readyz picks up a real Redis outage, and a task
// enqueued through mail.AsyncClient is actually processed by cmd/worker (dev
// fallback: logs instead of sending, since SMTP_HOST is unset). Runs its own
// throwaway Redis on a Docker-assigned ephemeral port — not the host's
// default 6379 — so it can't collide with a Redis someone already has
// running (this dev machine's own has auth enabled, which would otherwise
// make the readyz check fail for a reason that has nothing to do with the
// scaffold's own correctness).
step(hasDocker ? "add worker: scaffolds cache/queue/mail/cmd/worker, wires readyz, processes a real task" : "add worker: skipped (needs Docker for an isolated Redis)", () => {
  if (!hasDocker) return;

  goScaffold(["add", "worker"], fullApp);
  run("go", ["mod", "tidy"], fullApp);
  run("go", ["build", "./..."], fullApp);
  run("go", ["vet", "./..."], fullApp);

  // cmd/api opens Postgres before it ever gets to Redis (database.Open runs
  // first in main()) — needs a real DB up before it'll boot far enough to
  // reach the readyz check this step is actually testing. Let the Makefile
  // target handle its own local-psql-vs-docker fallback, same as every other
  // step that needs a DB.
  run("make", ["db-drop"], fullApp);
  run("make", ["db-create"], fullApp);

  // no --rm: this step stops the container mid-test (to prove readyz notices
  // Redis going down) then starts it again — --rm auto-deletes on stop, which
  // would leave nothing for `docker start` to restart. Cleaned up by hand in
  // the finally block instead.
  const containerId = run("docker", ["run", "-d", "-p", "0:6379", "redis:7-alpine"]).trim();
  try {
    let redisPort = readMappedPort(containerId);
    let redisUrl = `redis://localhost:${redisPort}/0`;

    // `docker exec redis-cli ping` only proves the container's *internal*
    // network is up — it says nothing about the host-mapped port this test
    // (and the app) actually connects through, which can lag behind after a
    // stop/start cycle. Poll the real host port instead, via bash's /dev/tcp
    // (no extra tool dependency).
    waitForPort(redisPort);

    const up = run(
      "bash",
      [
        "-c",
        `REDIS_URL='${redisUrl}' go run ./cmd/api >/tmp/go-scaffold-smoke-worker-api.log 2>&1 & sleep 3; ` +
          "CODE=$(curl -s -o /dev/null -w '%{http_code}' http://localhost:8080/readyz 2>/dev/null); CODE=${CODE:-000}; " +
          "lsof -ti:8080 | xargs -r kill -9; " +
          "echo \"READYZ=$CODE\"",
      ],
      fullApp
    );
    if (!/READYZ=200/.test(up)) throw new Error(`expected readyz 200 with Redis reachable, got: ${up}`);

    run("docker", ["stop", containerId]);
    const down = run(
      "bash",
      [
        "-c",
        `REDIS_URL='${redisUrl}' go run ./cmd/api >/tmp/go-scaffold-smoke-worker-api.log 2>&1 & sleep 3; ` +
          "CODE=$(curl -s -o /dev/null -w '%{http_code}' http://localhost:8080/readyz 2>/dev/null); CODE=${CODE:-000}; " +
          "lsof -ti:8080 | xargs -r kill -9; " +
          "echo \"READYZ=$CODE\"",
      ],
      fullApp
    );
    if (!/READYZ=503/.test(down)) throw new Error(`expected readyz 503 with Redis down, got: ${down}`);
    run("docker", ["start", containerId]);
    // Docker Desktop can hand out a *different* random host port on restart
    // when the container was published with an ephemeral mapping (-p 0:6379)
    // — re-read it rather than assuming `docker start` preserves the one from
    // `docker run`. Silently reusing the stale port here is exactly what
    // produced a flaky "port never accepted a connection" failure while
    // testing this: the container's logs showed Redis back up and accepting
    // connections in well under a second, on a port one number higher than
    // what this step kept polling.
    redisPort = readMappedPort(containerId);
    redisUrl = `redis://localhost:${redisPort}/0`;
    waitForPort(redisPort);

    const probeDir = path.join(fullApp, "cmd", "_smoke_probe_enqueue");
    execFileSync("mkdir", ["-p", probeDir]);
    writeFileSync(
      path.join(probeDir, "main.go"),
      `package main

import (
	"full-app/internal/platform/mail"
	"full-app/internal/platform/queue"
)

func main() {
	q, err := queue.NewClient("${redisUrl}")
	if err != nil {
		panic(err)
	}
	ac := mail.NewAsyncClient(q)
	if err := ac.Send("someone@example.com", "smoke test", "processed by cmd/worker"); err != nil {
		panic(err)
	}
}
`
    );

    // `go run ./cmd/worker & WPID=$!` doesn't work: `go run` compiles then
    // execs the binary as its OWN child, so $! is the `go` wrapper's PID, not
    // the actual worker process — `kill -9 $WPID` kills the wrapper and
    // leaves the real worker running forever, retrying against a container
    // that's long gone. Confirmed the hard way: seven of these accumulated
    // over the course of testing this step, one alive for hours, still
    // burning CPU on retry loops. Build the binary and run *that* directly so
    // the PID this test captures is the PID that actually needs to die.
    const workerLogPath = path.join(fullApp, "worker.log");
    run("go", ["build", "-o", "worker-bin", "./cmd/worker"], fullApp);
    run(
      "bash",
      [
        "-c",
        `REDIS_URL='${redisUrl}' ./worker-bin >'${workerLogPath}' 2>&1 & WPID=$!; sleep 2; ` +
          "go run ./cmd/_smoke_probe_enqueue; sleep 2; kill -9 $WPID 2>/dev/null",
      ],
      fullApp
    );
    rmSync(path.join(fullApp, "worker-bin"), { force: true });
    const workerLog = readFileSync(workerLogPath, "utf8");
    if (!workerLog.includes("email not sent (SMTP not configured)") || !workerLog.includes("processed by cmd/worker")) {
      throw new Error(`expected cmd/worker to process the enqueued task (dev SMTP fallback), got:\n${workerLog}`);
    }
    if (workerLog.includes("!BADKEY")) {
      throw new Error(`asynq's own log lines are leaking through the slog adapter malformed, got:\n${workerLog}`);
    }

    rmSync(probeDir, { recursive: true, force: true });
    run("make", ["db-drop"], fullApp);
  } finally {
    run("docker", ["rm", "-f", containerId]); // force-removes whether it's running or already stopped
  }
});

step("bare project: CI workflow renders with the right db name, valid trigger keys", () => {
  assertFileContains(path.join(fullApp, ".github", "workflows", "ci.yml"), "POSTGRES_DB: full_app");
  assertFileContains(path.join(fullApp, ".github", "workflows", "ci.yml"), "golangci-lint-action");
});

let hasGolangciLint = true;
try {
  run("golangci-lint", ["--version"]);
  // golangci-lint's result cache is keyed by file content, not absolute path —
  // this suite regenerates byte-identical "widget"/"order" packages across many
  // scratch dirs, so a stale cache entry (e.g. from before a template fix) can
  // get served with a file path from a since-deleted run. Start from empty.
  run("golangci-lint", ["cache", "clean"]);
} catch {
  hasGolangciLint = false;
}

step(
  hasGolangciLint
    ? "bare project: golangci-lint is clean out of the box (the CI gate the scaffold ships would pass)"
    : "bare project: golangci-lint not installed locally — skipping a real run",
  () => {
    if (!hasGolangciLint) return;
    const out = run("golangci-lint", ["run"], fullApp);
    if (out.trim() && !out.includes("0 issues")) throw new Error(`expected 0 issues, got:\n${out}`);
  }
);

let hasPsql = true;
try {
  run("psql", ["--version"]);
} catch {
  hasPsql = false;
}

let dockerPgContainer = null;
if (!hasPsql) {
  try {
    dockerPgContainer = run("docker", ["ps", "-q", "--filter", "publish=5432"]).trim().split("\n")[0] || null;
  } catch {
    dockerPgContainer = null;
  }
}

function listDatabases() {
  return hasPsql
    ? run("psql", ["-h", "localhost", "-U", "postgres", "-lqt"], undefined, { PGPASSWORD: "postgres" })
    : run("docker", ["exec", "-e", "PGPASSWORD=postgres", dockerPgContainer, "psql", "-U", "postgres", "-lqt"]);
}

step(
  hasPsql
    ? "make db-create is idempotent and actually creates the DB"
    : dockerPgContainer
      ? "make db-create falls back to docker exec (no local psql) and actually creates the DB"
      : "make db-create parses (no psql, no Postgres container — skipping a real run)",
  () => {
    if (!hasPsql && !dockerPgContainer) {
      run("make", ["-n", "db-create"], fullApp); // dry run: catches Makefile/shell syntax errors
      return;
    }
    run("make", ["db-drop"], fullApp); // start from a clean slate in case a prior run left it
    run("make", ["db-create"], fullApp);
    run("make", ["db-create"], fullApp); // must not error the second time
    const list = listDatabases();
    if (!list.includes("full_app")) throw new Error(`expected database "full_app" to exist, got:\n${list}`);
    run("make", ["db-drop"], fullApp);
  }
);

step("generate module order (full CRUD)", () => {
  goScaffold(["generate", "module", "order"], fullApp);
});

step("full module: docs wired into openapi.yaml", () => {
  assertFileContains(path.join(fullApp, "docs", "openapi.yaml"), "/v1/orders:");
  assertFileContains(path.join(fullApp, "docs", "openapi.yaml"), "OrderResponse");
});

step("main.go serves the whole docs/ tree, not just the index (or $ref resolution 404s over HTTP)", () => {
  assertFileContains(path.join(fullApp, "cmd", "api", "main.go"), 'r.Static("/docs", "./docs")');
});

let hasNpx = true;
try {
  run("npx", ["--version"]);
} catch {
  hasNpx = false;
}

step(
  hasNpx
    ? "make openapi-bundle resolves every $ref into one file (for importers like Bruno that don't)"
    : "make openapi-bundle skipped (npx not available)",
  () => {
    if (!hasNpx) return;
    run("make", ["openapi-bundle"], fullApp);
    const bundlePath = path.join(fullApp, "docs", "openapi.bundled.yaml");
    assertFileContains(bundlePath, "get:");
    assertFileContains(bundlePath, "post:");
    // the whole point: no $ref left pointing at a sibling file
    const bundled = readFileSync(bundlePath, "utf8");
    if (bundled.includes("$ref: './")) throw new Error("bundled spec still has unresolved external $refs");
  }
);

step("re-generating after deleting only the folder doesn't duplicate wiring (would panic gin)", () => {
  // simulate: user rm -rf's the module dir but main.go/openapi.yaml still
  // reference it, then re-runs generate module. Must stay a single Register.
  rmSync(path.join(fullApp, "internal", "app", "order"), { recursive: true, force: true });
  goScaffold(["generate", "module", "order"], fullApp);
  const mainGo = readFileSync(path.join(fullApp, "cmd", "api", "main.go"), "utf8");
  const registers = (mainGo.match(/order\.NewHandler\(/g) ?? []).length;
  if (registers !== 1) throw new Error(`expected exactly 1 order route registration, got ${registers}`);
  const openapi = readFileSync(path.join(fullApp, "docs", "openapi.yaml"), "utf8");
  const paths = (openapi.match(/\/v1\/orders:/g) ?? []).length;
  if (paths !== 1) throw new Error(`expected exactly 1 /v1/orders path in openapi.yaml, got ${paths}`);
  const migrations = readdirSync(path.join(fullApp, "migrations")).filter((f) => f.endsWith("_create_orders.up.sql")).length;
  if (migrations !== 1) throw new Error(`expected exactly 1 create_orders migration, got ${migrations}`);
});

step("full module: build + vet + gofmt clean", () => {
  run("go", ["build", "./..."], fullApp);
  run("go", ["vet", "./..."], fullApp);
  const dirty = run("gofmt", ["-l", "."], fullApp).trim();
  if (dirty) throw new Error(`gofmt found unformatted files:\n${dirty}`);
});

step("full module: go test ./... (integration tests skip without a DB)", () => {
  run("go", ["test", "./..."], fullApp);
});

for (const [name, args] of Object.entries({
  "patch (resource action)": ["approve", "--type", "patch"],
  "get --get-mode all": ["findActive", "--type", "get", "--get-mode", "all"],
  "get --get-mode one --field": ["findByStatus", "--type", "get", "--get-mode", "one", "--field", "status"],
  post: ["archive", "--type", "post"],
  delete: ["removeAttachment", "--type", "delete"],
})) {
  step(`generate method order: ${name}`, () => {
    goScaffold(["generate", "method", "order", ...args], fullApp);
  });
}

step("after 5 generate method calls: build + vet + gofmt + test", () => {
  run("go", ["build", "./..."], fullApp);
  run("go", ["vet", "./..."], fullApp);
  const dirty = run("gofmt", ["-l", "."], fullApp).trim();
  if (dirty) throw new Error(`gofmt found unformatted files:\n${dirty}`);
  run("go", ["test", "./..."], fullApp);
});

step(
  hasGolangciLint
    ? "after 5 generate method calls: still lint-clean"
    : "after 5 generate method calls: lint check skipped (golangci-lint not installed)",
  () => {
    if (!hasGolangciLint) return;
    const out = run("golangci-lint", ["run"], fullApp);
    if (out.trim() && !out.includes("0 issues")) throw new Error(`expected 0 issues, got:\n${out}`);
  }
);

step("generate method rejects a duplicate method name", () => {
  expectThrows(() => goScaffold(["generate", "method", "order", "approve", "--type", "patch"], fullApp), "already exists");
});

step("generate method rejects --field id", () => {
  expectThrows(
    () => goScaffold(["generate", "method", "order", "findById", "--type", "get", "--get-mode", "one", "--field", "id"], fullApp),
    'cannot be "id"'
  );
});

step("generate module rejects a name that already exists", () => {
  expectThrows(() => goScaffold(["generate", "module", "order"], fullApp), "already exists");
});

step("rejects reserved Go words before writing broken code (module/method/field)", () => {
  expectThrows(() => goScaffold(["generate", "module", "type"], fullApp), "reserved Go word");
  expectThrows(() => goScaffold(["generate", "module", "string"], fullApp), "reserved Go word");
  expectThrows(() => goScaffold(["generate", "method", "order", "func", "--type", "post"], fullApp), "Go keyword");
  expectThrows(
    () => goScaffold(["generate", "method", "order", "findByType", "--type", "get", "--get-mode", "one", "--field", "type"], fullApp),
    "Go keyword"
  );
  expectThrows(() => goScaffold(["generate", "module", "2fa"], fullApp), "starts with a digit");
});

step("remove module reverses wiring and re-generating stays clean", () => {
  goScaffold(["generate", "module", "widget"], fullApp);
  run("go", ["build", "./..."], fullApp);
  goScaffold(["remove", "module", "widget", "--yes"], fullApp);
  if (existsSync(path.join(fullApp, "internal", "app", "widget"))) throw new Error("widget folder not deleted");
  const mainGo = readFileSync(path.join(fullApp, "cmd", "api", "main.go"), "utf8");
  if (mainGo.includes("widget.NewHandler")) throw new Error("main.go still wires widget after remove");
  const openapi = readFileSync(path.join(fullApp, "docs", "openapi.yaml"), "utf8");
  if (openapi.includes("/v1/widgets:")) throw new Error("openapi still lists widgets after remove");
  run("go", ["build", "./..."], fullApp); // must still compile with widget gone
  goScaffold(["generate", "module", "widget"], fullApp); // re-adding must not duplicate
  const registers = (readFileSync(path.join(fullApp, "cmd", "api", "main.go"), "utf8").match(/widget\.NewHandler\(/g) ?? []).length;
  if (registers !== 1) throw new Error(`expected 1 widget registration after re-add, got ${registers}`);
  run("go", ["build", "./..."], fullApp);
});

step("create --api-prefix beta scaffolds routes under a custom prefix", () => {
  goScaffold(["create", "beta-app", "--defaults", "--api-prefix", "beta"], scratch);
});

const betaApp = path.join(scratch, "beta-app");
step("custom prefix: generate module + method, routes land under /beta", () => {
  run("go", ["mod", "tidy"], betaApp);
  goScaffold(["generate", "module", "product"], betaApp);
  goScaffold(["generate", "method", "product", "findByStatus", "--type", "get", "--get-mode", "one", "--field", "status"], betaApp);
  const mainGo = readFileSync(path.join(betaApp, "cmd", "api", "main.go"), "utf8");
  if (!mainGo.includes('api := r.Group("/beta")')) throw new Error('expected api := r.Group("/beta") in main.go');
  const openapi = readFileSync(path.join(betaApp, "docs", "openapi.yaml"), "utf8");
  if (!openapi.includes("/beta/products:")) throw new Error("expected /beta/products in openapi.yaml");
  run("go", ["build", "./..."], betaApp);
  run("go", ["vet", "./..."], betaApp);
});

step("create --api-prefix '' scaffolds routes with no prefix at all", () => {
  goScaffold(["create", "noprefix-app", "--defaults", "--api-prefix", ""], scratch);
  const app = path.join(scratch, "noprefix-app");
  run("go", ["mod", "tidy"], app);
  goScaffold(["generate", "module", "widget"], app);
  const mainGo = readFileSync(path.join(app, "cmd", "api", "main.go"), "utf8");
  if (!mainGo.includes('api := r.Group("/")')) throw new Error('expected api := r.Group("/") in main.go');
  const openapi = readFileSync(path.join(app, "docs", "openapi.yaml"), "utf8");
  if (!openapi.includes("/widgets:")) throw new Error("expected /widgets (no prefix) in openapi.yaml");
  if (openapi.includes("/v1/widgets:")) throw new Error("should not have a /v1 prefix");
  run("go", ["build", "./..."], app);
  run("go", ["vet", "./..."], app);
});

step("create --api-prefix api/v1 supports multi-segment prefixes (gin joins them fine)", () => {
  goScaffold(["create", "multiseg-app", "--defaults", "--api-prefix", "/api/v1/"], scratch);
  const app = path.join(scratch, "multiseg-app");
  const cfg = JSON.parse(readFileSync(path.join(app, "go-scaffold.config.json"), "utf8"));
  if (cfg.apiPrefix !== "api/v1") throw new Error(`expected leading/trailing slashes stripped, got "${cfg.apiPrefix}"`);
  run("go", ["mod", "tidy"], app);
  goScaffold(["generate", "module", "order"], app);
  const mainGo = readFileSync(path.join(app, "cmd", "api", "main.go"), "utf8");
  if (!mainGo.includes('api := r.Group("/api/v1")')) throw new Error('expected api := r.Group("/api/v1") in main.go');
  const openapi = readFileSync(path.join(app, "docs", "openapi.yaml"), "utf8");
  if (!openapi.includes("/api/v1/orders:")) throw new Error("expected /api/v1/orders in openapi.yaml");
  run("go", ["build", "./..."], app);
  run("go", ["vet", "./..."], app);
});

step("create --no-full minimal module layers up to full build", () => {
  goScaffold(["create", "min-app", "--defaults"], scratch);
  const minApp = path.join(scratch, "min-app");
  run("go", ["mod", "tidy"], minApp);
  goScaffold(["generate", "module", "widget", "--no-full"], minApp);
  run("go", ["build", "./..."], minApp);
  if (hasGolangciLint) {
    // bare minimal module, zero methods yet: the ahead-of-use plumbing
    // (fakeRepo, test harness, wrapFindErr, response/toResponse) must not
    // trip `unused` before anything has wired it in.
    const out = run("golangci-lint", ["run"], minApp);
    if (out.trim() && !out.includes("0 issues")) throw new Error(`bare minimal module: expected 0 issues, got:\n${out}`);
  }
  goScaffold(["generate", "method", "widget", "create", "--type", "post"], minApp);
  goScaffold(["generate", "method", "widget", "list", "--type", "get", "--get-mode", "all"], minApp);
  goScaffold(["generate", "method", "widget", "findByStatus", "--type", "get", "--get-mode", "one", "--field", "status"], minApp);
  run("go", ["build", "./..."], minApp);
  run("go", ["vet", "./..."], minApp);
  const dirty = run("gofmt", ["-l", "."], minApp).trim();
  if (dirty) throw new Error(`gofmt found unformatted files:\n${dirty}`);
  if (hasGolangciLint) {
    const out = run("golangci-lint", ["run"], minApp);
    if (out.trim() && !out.includes("0 issues")) throw new Error(`layered minimal module: expected 0 issues, got:\n${out}`);
  }
});

cleanup();
console.log(`\n${passed} checks passed.`);
