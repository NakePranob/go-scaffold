import fs from "fs-extra";
import { insertBeforeMarkerOnce } from "./marker-patch";

const IMPORT_MARKER = "// go-scaffold:imports";
const CONFIG_FIELDS_MARKER = "// go-scaffold:config-fields";
const CONFIG_LOAD_MARKER = "// go-scaffold:config-load";
const PLATFORM_INIT_MARKER = "// go-scaffold:platform-init";
const READYZ_MARKER = "// go-scaffold:readyz-checks";
const SHUTDOWN_MARKER = "// go-scaffold:shutdown";

// patchComposeForRedis adds a redis service to docker-compose.yml. Whatever
// pulls Redis in — `add worker --queue redis`, or `add auth`'s refresh-token
// store on top of a Postgres queue — makes cmd/api call cache.Open and adds a
// Redis ping to /readyz. Leaving compose Postgres-only meant the documented
// path (`make docker-up` then `make run`) produced a permanent 503, which is
// a rough first five minutes with a brand new project.
//
// No-op when the project was scaffolded with --no-docker.
export function patchComposeForRedis(composePath: string): void {
  if (!fs.existsSync(composePath)) return;
  const content = fs.readFileSync(composePath, "utf8");
  if (/^\s{2}redis:/m.test(content)) return;

  const service = [
    "  redis:",
    "    image: redis:7-alpine",
    "    ports:",
    '      - "6379:6379"',
  ].join("\n");

  // before the top-level `volumes:` key, so redis stays inside `services:`
  const out = content.includes("\nvolumes:")
    ? content.replace("\nvolumes:", () => `\n${service}\n\nvolumes:`)
    : content.replace(/\n?$/, "\n") + `\n${service}\n`;
  fs.writeFileSync(composePath, out);
}

// patchCiForRedis adds a redis service to .github/workflows/ci.yml, for the
// same reason patchComposeForRedis exists: once cmd/api calls cache.Open, a
// test that touches the token store has nothing to connect to on a runner
// whose only service is Postgres. The generated workflow was written at
// `create` time, before anything needed Redis, and nothing patched it after.
//
// No-op when the workflow was deleted or replaced by hand.
export function patchCiForRedis(ciPath: string): void {
  if (!fs.existsSync(ciPath)) return;
  const content = fs.readFileSync(ciPath, "utf8");
  if (/^\s{6}redis:/m.test(content)) return;

  // `steps:` sits one level under the job, so it's the first line that ends
  // the `services:` block — insert the service just above it.
  const stepsLine = content.split("\n").find((l) => l.trimEnd() === "    steps:");
  if (!stepsLine) return;

  const service = [
    "      redis:",
    "        image: redis:7-alpine",
    "        ports:",
    "          - 6379:6379",
    "        options: >-",
    '          --health-cmd "redis-cli ping"',
    "          --health-interval 10s",
    "          --health-timeout 5s",
    "          --health-retries 5",
    "",
  ].join("\n");

  fs.writeFileSync(ciPath, content.replace(stepsLine, () => `${service}\n${stepsLine}`));
}

// patchConfigForRedis adds RedisURL to Config and its env() load to Load().
// Split out from the worker patch because Redis is no longer the worker's
// concern by default — `add auth` needs it for the refresh-token store even
// when the queue lives in Postgres.
export function patchConfigForRedis(configGoPath: string): void {
  let content = fs.readFileSync(configGoPath, "utf8");
  content = insertBeforeMarkerOnce(content, CONFIG_FIELDS_MARKER, "RedisURL string", "RedisURL");
  content = insertBeforeMarkerOnce(
    content,
    CONFIG_LOAD_MARKER,
    'RedisURL: env("REDIS_URL", "redis://localhost:6379/0"),',
    'env("REDIS_URL"'
  );
  fs.writeFileSync(configGoPath, content);
}

// patchConfigForWorker adds the SMTP_* fields (and RedisURL, when Redis is
// the queue's backing store) to Config and their env() loads to Load() — via
// marker comments, the same text-insertion approach as patchMainGo, since
// config.go.hbs is only rendered once (at `create`) and everything after
// that is a real file a human may have already edited.
export function patchConfigForWorker(configGoPath: string, opts: { redis: boolean }): void {
  if (opts.redis) patchConfigForRedis(configGoPath);
  patchConfigForSMTP(configGoPath);
}

// Sentinels here match a bare identifier, never `Name string` or
// `Name: env(...)`: gofmt aligns struct fields and map values into columns, so
// the moment one of these blocks lands the literal spacing a sentinel was
// written with no longer exists in the file. A sentinel that misses means the
// block gets inserted a second time and the project stops compiling on a
// redeclared field — which is exactly what `add auth` then `add worker` did.
//
// patchConfigForSMTP is split out because `add auth` needs these fields even
// when there is no worker: without a queue it sends mail synchronously, and it
// still has to know where to send it. Idempotent, so whichever command gets
// here first wins and the second is a no-op.
export function patchConfigForSMTP(configGoPath: string): void {
  let content = fs.readFileSync(configGoPath, "utf8");

  const fieldsBlock = ["SMTPHost string", "SMTPPort string", "SMTPUsername string", "SMTPPassword string", "SMTPFrom string"].join("\n");
  content = insertBeforeMarkerOnce(content, CONFIG_FIELDS_MARKER, fieldsBlock, "SMTPHost");

  const loadBlock = [
    'SMTPHost:     env("SMTP_HOST", ""),',
    'SMTPPort:     env("SMTP_PORT", "587"),',
    'SMTPUsername: env("SMTP_USERNAME", ""),',
    'SMTPPassword: env("SMTP_PASSWORD", ""),',
    'SMTPFrom:     env("SMTP_FROM", "no-reply@example.local"),',
  ].join("\n");
  content = insertBeforeMarkerOnce(content, CONFIG_LOAD_MARKER, loadBlock, 'env("SMTP_HOST"');

  fs.writeFileSync(configGoPath, content);
}

// patchMainGoForWorker wires Redis into cmd/api: opened alongside the DB, and
// pinged as part of /readyz (so a Redis outage is caught the same way a DB
// outage already is). It does not create a queue.Client — nothing in cmd/api
// enqueues a task until some domain actually needs to (e.g. a future `add
// auth`'s forgot-password flow); an unused *queue.Client sitting in main()
// would just be dead weight until then.
export function patchMainGoForWorker(mainGoPath: string, goModule: string): void {
  let content = fs.readFileSync(mainGoPath, "utf8");

  const cacheImport = `"${goModule}/internal/platform/cache"`;
  content = insertBeforeMarkerOnce(content, IMPORT_MARKER, cacheImport, cacheImport);

  const initBlock = ["rdb, err := cache.Open(cfg)", "if err != nil {", '\tlogger.Error("open redis", "error", err)', "\tos.Exit(1)", "}"].join("\n");
  content = insertBeforeMarkerOnce(content, PLATFORM_INIT_MARKER, initBlock, "rdb, err := cache.Open(cfg)");

  const readyzBlock = [
    "if err := rdb.Ping(c.Request.Context()).Err(); err != nil {",
    '\tc.JSON(http.StatusServiceUnavailable, gin.H{"status": "unavailable"})',
    "\treturn",
    "}",
  ].join("\n");
  content = insertBeforeMarkerOnce(content, READYZ_MARKER, readyzBlock, "if err := rdb.Ping(");

  const shutdownBlock = ["if err := rdb.Close(); err != nil {", '\tlogger.Error("close redis", "error", err)', "}"].join("\n");
  content = insertBeforeMarkerOnce(content, SHUTDOWN_MARKER, shutdownBlock, "if err := rdb.Close()");

  fs.writeFileSync(mainGoPath, content);
}
