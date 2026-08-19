// `add auth --store` picks where tokens and rate-limit counters live. The two
// wiring lines it produces are also rewritten by `add rbac`, in a second file,
// so the risk this covers is those two drifting apart — a project that builds
// after `add auth` and stops building after `add rbac`.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(path.dirname(path.dirname(fileURLToPath(import.meta.url))));
const CLI = path.join(ROOT, "bin", "go-scaffold.js");

function cli(cwd, ...args) {
  return execFileSync("node", [CLI, ...args], { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
}

function project(t, store) {
  const dir = mkdtempSync(path.join(tmpdir(), `go-scaffold-store-${store}-`));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  cli(dir, "create", "app", "--defaults", "--no-docker");
  const app = path.join(dir, "app");
  cli(app, "add", "worker", "--queue", "postgres");
  cli(app, "add", "auth", "--store", store);
  return app;
}

const read = (app, ...p) => readFileSync(path.join(app, ...p), "utf8");
const has = (app, ...p) => existsSync(path.join(app, ...p));

test("--store postgres writes the Postgres store and no Redis anywhere", (t) => {
  const app = project(t, "postgres");

  assert.ok(has(app, "internal/app/user/tokenstore_pg.go"));
  assert.ok(has(app, "internal/app/user/model/authtoken.go"));
  assert.ok(has(app, "internal/shared/middleware/ratelimit_memory.go"));
  assert.ok(!has(app, "internal/app/user/tokenstore_redis.go"), "the Redis store must not be written");
  assert.ok(!has(app, "internal/platform/cache/redis.go"), "no Redis client is needed");

  const main = read(app, "cmd/api/main.go");
  assert.match(main, /user\.NewPgTokenStore\(db\)/);
  assert.match(main, /middleware\.NewMemoryLimiter\(\)/);
  assert.doesNotMatch(main, /rdb/, "main.go must not reference a Redis client");
  // the table AutoMigrate needs in dev, and the migration prod uses
  assert.match(main, /&usermodel\.AuthToken\{\},/);
  assert.ok(
    readFileSync(path.join(app, "migrations", "embed.go"), "utf8") &&
      execFileSync("ls", [path.join(app, "migrations")], { encoding: "utf8" }).includes("_create_auth_tokens.up.sql"),
    "the auth_tokens migration must be generated"
  );
});

test("--store redis keeps the previous wiring", (t) => {
  const app = project(t, "redis");

  assert.ok(has(app, "internal/app/user/tokenstore_redis.go"));
  assert.ok(has(app, "internal/shared/middleware/ratelimit_redis.go"));
  assert.ok(!has(app, "internal/app/user/tokenstore_pg.go"), "the Postgres store must not be written");
  assert.ok(has(app, "internal/platform/cache/redis.go"), "add auth pulls Redis in on this path");

  const main = read(app, "cmd/api/main.go");
  assert.match(main, /user\.NewRedisTokenStore\(rdb\)/);
  assert.match(main, /middleware\.NewRedisLimiter\(rdb\)/);
  assert.doesNotMatch(main, /&usermodel\.AuthToken\{\},/, "no auth_tokens table on this path");
});

// add rbac rebuilds both lines to insert authz. Given it lives in a different
// patcher, this is the assertion that keeps it honest for both stores.
for (const store of ["postgres", "redis"]) {
  test(`add rbac rewrites the handler line correctly on --store ${store}`, (t) => {
    const app = project(t, store);
    cli(app, "add", "rbac");

    const main = read(app, "cmd/api/main.go");
    const limiter = store === "postgres" ? "middleware.NewMemoryLimiter()" : "middleware.NewRedisLimiter(rdb)";
    assert.ok(
      main.includes(`cfg.CookieSameSite, ${limiter}, authz).Register(api)`),
      `expected authz inside NewHandler's arguments, got:\n${main.split("\n").filter((l) => l.includes("user.NewHandler")).join("\n")}`
    );
    assert.ok(!main.includes(`${limiter}), authz)`), "authz landed outside the argument list");
  });
}

// `add auth` used to refuse without `add worker`, which meant a project that
// only wanted login had to take a queue, a backend decision and a second
// binary. Now it stands alone and sends inline — and `add worker` arriving
// later has to actually move the mail onto the queue, or the message the CLI
// prints when it wires the sync mailer is a lie.
test("add auth stands alone, and a later add worker moves its mail onto the queue", (t) => {
  const dir = mkdtempSync(path.join(tmpdir(), "go-scaffold-solo-auth-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  cli(dir, "create", "app", "--defaults", "--no-docker");
  const app = path.join(dir, "app");

  cli(app, "add", "auth"); // no worker anywhere

  assert.ok(has(app, "internal/platform/mail/mail.go"), "the SMTP client has to come along");
  assert.ok(!has(app, "internal/platform/queue"), "no queue was asked for");
  assert.ok(!has(app, "cmd/worker"), "no second binary was asked for");
  assert.match(read(app, "cmd/api/main.go"), /mail\.NewSyncClient\(mail\.Open\(cfg\)\)/);
  assert.match(read(app, ".env.example"), /^SMTP_HOST=/m, "auth has to bring the SMTP env block too");

  cli(app, "add", "worker", "--queue", "postgres");

  const main = read(app, "cmd/api/main.go");
  assert.match(main, /mail\.NewAsyncClient\(q\)/, "the mailer must move onto the queue");
  assert.doesNotMatch(main, /mail\.NewSyncClient/, "the synchronous mailer must be gone");
  assert.match(main, /q, err := queue\.NewRiverEnqueuer\(db\)/, "the enqueuer has to be built");
  assert.match(main, /q\.Close\(\)/, "and closed on shutdown");

  // gofmt aligns struct fields into columns, so a sentinel written as
  // "SMTPHost string" stops matching the moment the block lands — which had
  // this exact sequence insert the SMTP config twice and stop compiling.
  const config = read(app, "internal/shared/config/config.go");
  assert.equal((config.match(/SMTPHost/g) ?? []).length, 2, "SMTP config was added twice");
  assert.equal((config.match(/JWTSecret\s+string/g) ?? []).length, 1, "JWT config was added twice");
});
