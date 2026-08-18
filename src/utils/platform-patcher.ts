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

// patchConfigForRedis adds RedisURL to Config and its env() load to Load().
// Split out from the worker patch because Redis is no longer the worker's
// concern by default — `add auth` needs it for the refresh-token store even
// when the queue lives in Postgres.
export function patchConfigForRedis(configGoPath: string): void {
  let content = fs.readFileSync(configGoPath, "utf8");
  content = insertBeforeMarkerOnce(content, CONFIG_FIELDS_MARKER, "RedisURL string", "RedisURL string");
  content = insertBeforeMarkerOnce(
    content,
    CONFIG_LOAD_MARKER,
    'RedisURL: env("REDIS_URL", "redis://localhost:6379/0"),',
    'RedisURL: env("REDIS_URL"'
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

  let content = fs.readFileSync(configGoPath, "utf8");

  const fieldsBlock = ["SMTPHost string", "SMTPPort string", "SMTPUsername string", "SMTPPassword string", "SMTPFrom string"].join("\n");
  content = insertBeforeMarkerOnce(content, CONFIG_FIELDS_MARKER, fieldsBlock, "SMTPHost string");

  const loadBlock = [
    'SMTPHost:     env("SMTP_HOST", ""),',
    'SMTPPort:     env("SMTP_PORT", "587"),',
    'SMTPUsername: env("SMTP_USERNAME", ""),',
    'SMTPPassword: env("SMTP_PASSWORD", ""),',
    'SMTPFrom:     env("SMTP_FROM", "no-reply@example.local"),',
  ].join("\n");
  content = insertBeforeMarkerOnce(content, CONFIG_LOAD_MARKER, loadBlock, 'SMTPHost:     env("SMTP_HOST"');

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
