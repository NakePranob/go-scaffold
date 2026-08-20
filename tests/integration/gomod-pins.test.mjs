// The `add *` commands used to add imports and touch go.mod not at all, so
// `go mod tidy` picked whatever was newest that day. These assert the pins
// reach the generated project, so a build is reproducible from the CLI version
// alone.
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(path.dirname(path.dirname(fileURLToPath(import.meta.url))));
const CLI = path.join(ROOT, "bin", "go-scaffold.js");

function cli(cwd, ...args) {
  execFileSync("node", [CLI, ...args], { cwd, stdio: ["ignore", "pipe", "pipe"] });
}

function scaffold(t) {
  const dir = mkdtempSync(path.join(tmpdir(), "gs-pins-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  cli(dir, "create", "app", "--defaults");
  return path.join(dir, "app");
}

// module path -> the version we expect pinned, for every dep a feature adds
const PINS = {
  river: ["github.com/riverqueue/river", "github.com/riverqueue/river/riverdriver/riverdatabasesql"],
  asynq: ["github.com/hibiken/asynq", "github.com/redis/go-redis/v9"],
  auth: ["github.com/golang-jwt/jwt/v5", "golang.org/x/crypto", "golang.org/x/oauth2"],
  observability: [
    "github.com/prometheus/client_golang",
    "go.opentelemetry.io/otel",
    "go.opentelemetry.io/otel/exporters/otlp/otlptrace/otlptracehttp",
    "go.opentelemetry.io/otel/sdk",
    "go.opentelemetry.io/otel/trace",
  ],
};

function pinnedModules(app) {
  return new Set(
    readFileSync(path.join(app, "go.mod"), "utf8")
      .split("\n")
      .map((l) => l.trim().split(/\s+/))
      .filter((parts) => parts.length >= 2 && /^v\d/.test(parts[1]))
      .map((parts) => parts[0])
  );
}

function assertPinned(app, modules) {
  const pinned = pinnedModules(app);
  for (const m of modules) assert.ok(pinned.has(m), `${m} should be pinned in go.mod`);
}

test("add worker --queue postgres pins River", (t) => {
  const app = scaffold(t);
  cli(app, "add", "worker", "--queue", "postgres", "--yes");
  assertPinned(app, PINS.river);
  assert.ok(!pinnedModules(app).has("github.com/hibiken/asynq"), "the Redis backend's deps must not come along");
});

test("add worker --queue redis pins Asynq and go-redis", (t) => {
  const app = scaffold(t);
  cli(app, "add", "worker", "--queue", "redis", "--yes");
  assertPinned(app, PINS.asynq);
  assert.ok(!pinnedModules(app).has("github.com/riverqueue/river"), "River must not come along");
});

test("add auth and add observability pin their own dependencies", (t) => {
  const app = scaffold(t);
  cli(app, "add", "worker", "--defaults");
  cli(app, "add", "auth", "--defaults");
  assertPinned(app, PINS.auth);
  // the default store is Postgres, and nothing in the project constructs a
  // Redis client — pinning go-redis anyway would put a dependency in go.mod
  // for a file that was never written
  assert.ok(!pinnedModules(app).has("github.com/redis/go-redis/v9"), "go-redis must not come along with --store postgres");

  cli(app, "add", "observability", "--yes");
  assertPinned(app, PINS.observability);
  // and auth's pins survive a later add
  assertPinned(app, PINS.auth);
});

test("add auth --store redis pins go-redis, and only then", (t) => {
  const app = scaffold(t);
  cli(app, "add", "worker", "--defaults"); // River — no Redis yet
  cli(app, "add", "auth", "--store", "redis", "--yes");
  assertPinned(app, [...PINS.auth, "github.com/redis/go-redis/v9"]);
});

// One require line per module, whatever order the features were added in.
test("no duplicate require lines when features share a dependency", (t) => {
  const app = scaffold(t);
  cli(app, "add", "worker", "--queue", "redis", "--yes"); // pins go-redis
  cli(app, "add", "auth", "--store", "redis", "--yes"); // wants go-redis too

  const lines = readFileSync(path.join(app, "go.mod"), "utf8")
    .split("\n")
    .filter((l) => l.trim().startsWith("github.com/redis/go-redis/v9 "));
  assert.equal(lines.length, 1, `expected one go-redis require, got ${lines.length}`);
});
