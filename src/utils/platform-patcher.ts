import fs from "fs-extra";
import { insertBeforeMarkerOnce } from "./marker-patch";

const IMPORT_MARKER = "// go-scaffold:imports";
const CONFIG_FIELDS_MARKER = "// go-scaffold:config-fields";
const CONFIG_LOAD_MARKER = "// go-scaffold:config-load";
const PLATFORM_INIT_MARKER = "// go-scaffold:platform-init";
const READYZ_MARKER = "// go-scaffold:readyz-checks";
const SHUTDOWN_MARKER = "// go-scaffold:shutdown";

// patchConfigForWorker adds RedisURL + SMTP_* fields to Config and their
// env() loads to Load() — via marker comments, the same text-insertion
// approach as patchMainGo, since config.go.hbs is only rendered once (at
// `create`) and everything after that is a real file a human may have
// already edited.
export function patchConfigForWorker(configGoPath: string): void {
  let content = fs.readFileSync(configGoPath, "utf8");

  const fieldsBlock = ["RedisURL string", "", "SMTPHost string", "SMTPPort string", "SMTPUsername string", "SMTPPassword string", "SMTPFrom string"].join(
    "\n"
  );
  content = insertBeforeMarkerOnce(content, CONFIG_FIELDS_MARKER, fieldsBlock, "RedisURL string");

  const loadBlock = [
    'RedisURL: env("REDIS_URL", "redis://localhost:6379/0"),',
    "",
    'SMTPHost:     env("SMTP_HOST", ""),',
    'SMTPPort:     env("SMTP_PORT", "587"),',
    'SMTPUsername: env("SMTP_USERNAME", ""),',
    'SMTPPassword: env("SMTP_PASSWORD", ""),',
    'SMTPFrom:     env("SMTP_FROM", "no-reply@example.local"),',
  ].join("\n");
  content = insertBeforeMarkerOnce(content, CONFIG_LOAD_MARKER, loadBlock, 'RedisURL: env("REDIS_URL"');

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
