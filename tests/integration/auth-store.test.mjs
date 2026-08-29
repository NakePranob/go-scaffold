// `add auth --store` picks where tokens and rate-limit counters live. The two
// wiring lines it produces are also rewritten by `add rbac`, in a second file,
// so the risk this covers is those two drifting apart — a project that builds
// after `add auth` and stops building after `add rbac`.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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
  cli(app, "add", "worker", "--queue", "postgres", "--yes");
  cli(app, "add", "auth", "--store", store, "--yes");
  return app;
}

const read = (app, ...p) => readFileSync(path.join(app, ...p), "utf8");
const has = (app, ...p) => existsSync(path.join(app, ...p));

test("--store postgres writes the Postgres store and no Redis anywhere", (t) => {
  const app = project(t, "postgres");

  assert.ok(has(app, "internal/app/user/adapters/outbound/postgres/tokenstore_pg.go"));
  assert.ok(has(app, "internal/app/user/adapters/outbound/postgres/tokenstore_pg_test.go"));
  assert.ok(has(app, "internal/app/user/adapters/outbound/postgres/model.go"));
  assert.ok(has(app, "internal/shared/middleware/ratelimit_memory.go"));
  assert.ok(!has(app, "internal/app/user/adapters/outbound/redis/tokenstore.go"), "the Redis store must not be written");
  assert.ok(!has(app, "internal/platform/cache/redis.go"), "no Redis client is needed");

  const main = read(app, "cmd/api/wiring.go");
  const composition = read(app, "internal/app/user/composition.go");
  assert.match(composition, /NewPgTokenStore\(db\)/);
  assert.match(composition, /middleware\.NewMemoryLimiter\(\)/);
  assert.match(main, /user\.NewHandlerFromDB\(db, cfg, q, nil, nil\)\.Register\(api\)/);
  assert.doesNotMatch(main, /user\.NewService\(|user\.NewHandler\(userSvc/);
  assert.doesNotMatch(main, /rdb/, "wiring.go must not reference a Redis client");
  // the table AutoMigrate needs in dev, and the migration prod uses
  assert.match(main, /&usermodel\.AuthToken\{\},/);
  assert.ok(
    readFileSync(path.join(app, "migrations", "embed.go"), "utf8") &&
      execFileSync("ls", [path.join(app, "migrations")], { encoding: "utf8" }).includes("_create_auth_tokens.up.sql"),
    "the auth_tokens migration must be generated"
  );
});

test("--store redis keeps refresh wiring and uses Postgres recovery tokens", (t) => {
  const app = project(t, "redis");

  assert.ok(has(app, "internal/app/user/adapters/outbound/redis/tokenstore.go"));
  assert.ok(has(app, "internal/app/user/adapters/outbound/redis/tokenstore_test.go"));
  assert.ok(has(app, "internal/shared/middleware/ratelimit_redis.go"));
  assert.ok(!has(app, "internal/app/user/adapters/outbound/postgres/tokenstore_pg.go"), "the Postgres store must not be written");
  assert.ok(has(app, "internal/platform/cache/redis.go"), "add auth pulls Redis in on this path");

  const ci = read(app, ".github/workflows/ci.yml");
  assert.match(ci, /redis:\n\s+image: redis:7-alpine/, "Redis auth must add a real Redis service to CI");
  assert.match(ci, /TEST_REDIS_URL: redis:\/\/127\.0\.0\.1:6379\/0/, "Redis auth CI must point tests at the service");
  assert.match(ci, /REQUIRE_TEST_REDIS: "true"/, "Redis auth CI must not allow integration tests to skip");

  const main = read(app, "cmd/api/wiring.go");
  const composition = read(app, "internal/app/user/composition.go");
  assert.match(composition, /NewRedisTokenStore\(rdb, db\)/);
  assert.match(composition, /middleware\.NewRedisLimiter\(rdb\)/);
  assert.match(main, /user\.NewHandlerFromDB\(db, cfg, rdb, q, nil, nil\)\.Register\(api\)/);
  assert.doesNotMatch(main, /user\.NewService\(|user\.NewHandler\(userSvc/);
  assert.match(main, /&usermodel\.AuthToken\{\},/, "recovery tokens need the auth_tokens table");
  assert.ok(has(app, "internal/app/user/adapters/outbound/postgres/tokenstore_recovery.go"));
  assert.ok(
    execFileSync("ls", [path.join(app, "migrations")], { encoding: "utf8" }).includes("_create_auth_tokens.up.sql"),
    "the auth_tokens migration must also be generated for Redis refresh storage"
  );
});

// add rbac composes role locally and passes only its public capabilities into
// auth. Given it lives in a different patcher, this is the integration guard
// that keeps auth/RBAC wiring aligned for both stores.
for (const store of ["postgres", "redis"]) {
  test(`add rbac rewrites the handler line correctly on --store ${store}`, (t) => {
    const app = project(t, store);
    cli(app, "add", "rbac", "--yes");

    const main = read(app, "cmd/api/wiring.go");
    const authArgs = store === "postgres" ? "db, cfg, q" : "db, cfg, rdb, q";
    assert.ok(
      main.includes(`roleComposition := role.NewCompositionFromDB(db, cfg.JWTSecret, cfg.AuthzCacheTTL)`) &&
        main.includes(`user.NewHandlerFromDB(${authArgs}, roleComposition.Service, roleComposition.Authz).Register(api)`),
      `expected feature-local auth/RBAC composition, got:\n${main.split("\n").filter((l) => l.includes("Composition") || l.includes("user.NewHandler")).join("\n")}`
    );
    assert.match(main, /roleComposition\.Handler\.Register\(api\)/);
    assert.doesNotMatch(main, /role\.NewService\(|role\.NewHandler\(/, "wiring.go must not construct role internals");
    assert.doesNotMatch(main, /user\.NewService\(|user\.NewHandler\(userSvc/, "wiring.go must not construct user internals");
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

  cli(app, "add", "auth", "--defaults"); // no worker anywhere

  assert.ok(has(app, "internal/platform/mail/mail.go"), "the SMTP client has to come along");
  assert.ok(!has(app, "internal/platform/queue"), "no queue was asked for");
  assert.ok(!has(app, "cmd/worker"), "no second binary was asked for");
  assert.match(read(app, "cmd/api/wiring.go"), /user\.NewHandlerFromDB\(db, cfg, nil, nil\)\.Register\(api\)/);
  assert.match(read(app, "internal/app/user/composition.go"), /mail\.NewSyncClient\(mail\.Open\(cfg\)\)/);
  assert.match(read(app, ".env.example"), /^SMTP_HOST=/m, "auth has to bring the SMTP env block too");

  cli(app, "add", "worker", "--queue", "postgres", "--yes");

  const main = read(app, "cmd/api/wiring.go");
  assert.match(read(app, "internal/app/user/composition.go"), /mail\.NewAsyncClient\(q\)/, "the feature-local mailer must move onto the queue");
  assert.doesNotMatch(read(app, "internal/app/user/composition.go"), /mail\.NewSyncClient/, "the synchronous mailer must be gone");
  assert.match(main, /user\.NewHandlerFromDB\(db, cfg, q, nil, nil\)\.Register\(api\)/);
  assert.match(main, /q, err := queue\.NewRiverEnqueuer\(db\)/, "the enqueuer has to be built");
  assert.match(main, /q\.Close\(\)/, "and closed on shutdown");

  // gofmt aligns struct fields into columns, so a sentinel written as
  // "SMTPHost string" stops matching the moment the block lands — which had
  // this exact sequence insert the SMTP config twice and stop compiling.
  const config = read(app, "internal/shared/config/config.go");
  assert.equal((config.match(/SMTPHost/g) ?? []).length, 2, "SMTP config was added twice");
  assert.equal((config.match(/JWTSecret\s+string/g) ?? []).length, 1, "JWT config was added twice");
});

// `add worker --queue redis` takes a materially different path than postgres:
// a separate cache.Open(Redis) client, queue.NewAsynqEnqueuer instead of
// queue.NewRiverEnqueuer, and an extra rdb.Ping in readyz. The postgres test
// above doesn't exercise any of that, so it wouldn't catch a regression
// specific to the redis queue backend — including the printed summary, which
// used to unconditionally claim "cmd/api does not enqueue anything yet" even
// when auth was already there and its mailer just got moved onto the queue.
test("add auth stands alone, and a later add worker --queue redis moves its mail onto the queue", (t) => {
  const dir = mkdtempSync(path.join(tmpdir(), "go-scaffold-solo-auth-redis-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  cli(dir, "create", "app", "--defaults", "--no-docker");
  const app = path.join(dir, "app");

  cli(app, "add", "auth", "--defaults"); // no worker anywhere
  assert.match(read(app, "cmd/api/wiring.go"), /user\.NewHandlerFromDB\(db, cfg, nil, nil\)\.Register\(api\)/);
  assert.match(read(app, "internal/app/user/composition.go"), /mail\.NewSyncClient\(mail\.Open\(cfg\)\)/);

  const out = cli(app, "add", "worker", "--queue", "redis", "--yes");
  assert.match(out, /auth's mailer now enqueues onto it/, "the printed summary must say the mailer actually moved, not that cmd/api still enqueues nothing");

  const main = read(app, "cmd/api/wiring.go");
  assert.match(read(app, "internal/app/user/composition.go"), /mail\.NewAsyncClient\(q\)/, "the feature-local mailer must move onto the queue");
  assert.doesNotMatch(read(app, "internal/app/user/composition.go"), /mail\.NewSyncClient/, "the synchronous mailer must be gone");
  assert.match(main, /user\.NewHandlerFromDB\(db, cfg, q, nil, nil\)\.Register\(api\)/);
  assert.match(main, /q, err := queue\.NewAsynqEnqueuer\(cfg\.RedisURL\)/, "the asynq enqueuer has to be built");
  assert.match(main, /rdb, err := cache\.Open\(cfg\)/, "the redis client backing the queue has to be built");
  assert.match(main, /rdb\.Ping\(c\.Request\.Context\(\)\)/, "readyz must gain a redis check");
  assert.match(main, /q\.Close\(\)/, "and the queue closed on shutdown");
  assert.match(main, /rdb\.Close\(\)/, "and the redis client closed on shutdown");

  const config = read(app, "internal/shared/config/config.go");
  assert.equal((config.match(/RedisURL/g) ?? []).length, 2, "redis config was added twice (field + env load)");

  // `add auth` (standalone) already wrote SMTP_HOST into .env.example before
  // the worker ever ran. patchEnvExample used to gate both its SMTP and Redis
  // blocks behind one `already has SMTP_HOST` check, so REDIS_URL silently
  // never got written here even though config.go now reads it.
  assert.match(read(app, ".env.example"), /^REDIS_URL=/m, "REDIS_URL must land in .env.example even though SMTP_HOST got there first");
});

// A project can add RBAC before a worker. Auth's local composition stays
// synchronous, while root only registers the role-aware handler.
test("add rbac composes auth and role locally on a project that never ran add worker", (t) => {
  const dir = mkdtempSync(path.join(tmpdir(), "go-scaffold-rbac-noworker-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  cli(dir, "create", "app", "--defaults", "--no-docker");
  const app = path.join(dir, "app");

  cli(app, "add", "auth", "--defaults");
  cli(app, "add", "rbac", "--yes");

  const main = read(app, "cmd/api/wiring.go");
  assert.match(main, /roleComposition := role\.NewCompositionFromDB\(db, cfg\.JWTSecret, cfg\.AuthzCacheTTL\)/);
  assert.match(main, /user\.NewHandlerFromDB\(db, cfg, roleComposition\.Service, roleComposition\.Authz\)\.Register\(api\)/);
  assert.match(main, /roleComposition\.Handler\.Register\(api\)/);
  assert.match(read(app, "internal/app/user/composition.go"), /mail\.NewSyncClient\(mail\.Open\(cfg\)\)/);
  assert.match(read(app, "internal/app/user/application/service.go"), /roles\s+ports\.RoleChecker/);
});

for (const store of ["postgres", "redis"]) {
  test(`adding worker after RBAC upgrades auth composition on --store ${store}`, (t) => {
    const dir = mkdtempSync(path.join(tmpdir(), `go-scaffold-rbac-worker-${store}-`));
    t.after(() => rmSync(dir, { recursive: true, force: true }));
    cli(dir, "create", "app", "--defaults", "--no-docker");
    const app = path.join(dir, "app");

    cli(app, "add", "auth", "--store", store, "--yes");
    cli(app, "add", "rbac", "--yes");
    cli(app, "add", "worker", "--queue", "postgres", "--yes");

    const main = read(app, "cmd/api/wiring.go");
    const composition = read(app, "internal/app/user/composition.go");
    const authArgs = store === "postgres" ? "db, cfg, q" : "db, cfg, rdb, q";
    assert.match(composition, /q queue\.Enqueuer/);
    assert.match(composition, /mail\.NewAsyncClient\(q\)/);
    assert.match(main, new RegExp(`user\\.NewHandlerFromDB\\(${authArgs}, roleComposition\\.Service, roleComposition\\.Authz\\)\\.Register\\(api\\)`));
    assert.doesNotMatch(main, /user\.NewService\(|role\.NewService\(|mail\.NewAsyncClient/);
  });
}

// Every other file rbac touches is patched before main.go, so a mismatch used
// to land after user.NewService had already grown a roleChecker parameter —
// a project that no longer compiled, and an error telling you to restore a
// line that wouldn't have fixed it.
test("add rbac checks wiring.go before it edits anything else", (t) => {
  const dir = mkdtempSync(path.join(tmpdir(), "go-scaffold-rbac-preflight-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  cli(dir, "create", "app", "--defaults", "--no-docker");
  const app = path.join(dir, "app");
  cli(app, "add", "auth", "--defaults");

  const mainPath = path.join(app, "cmd", "api", "wiring.go");
  writeFileSync(
    mainPath,
    readFileSync(mainPath, "utf8").replace("user.NewHandlerFromDB(", "user.NewHandlerFromDB( /* hand edited */ ")
  );

  assert.throws(() => cli(app, "add", "rbac", "--yes"), /doesn't match what `add auth` wrote/);

  assert.match(
    read(app, "internal/app/user/application/service.go"),
    /func \(s \*Service\) SetRole\(/,
    "the canonical auth role capability remains unchanged when the pre-flight refuses"
  );
  assert.equal(has(app, "internal/app/user/model"), false, "auth must not create a second model package");
  assert.ok(!has(app, "internal/app/role"), "no role domain may be written either");
});
