import fs from "fs-extra";
import { insertBeforeMarkerOnce } from "./marker-patch";
import { AuthStore, QueueBackend } from "../types";

const IMPORT_MARKER = "// go-scaffold:imports";
const CONFIG_FIELDS_MARKER = "// go-scaffold:config-fields";
const CONFIG_LOAD_MARKER = "// go-scaffold:config-load";
const CONFIG_CHECKS_MARKER = "// go-scaffold:config-checks";
const PLATFORM_INIT_MARKER = "// go-scaffold:platform-init";
const SCHEMA_MARKER = "// go-scaffold:schemas";
const MODEL_MARKER = "// go-scaffold:models";
const ROUTE_MARKER = "// go-scaffold:routes";
const SHUTDOWN_MARKER = "// go-scaffold:shutdown";

// patchConfigForAuth adds JWT/cookie/password-reset/Google OAuth fields to
// Config, the same marker-based text insertion patchConfigForWorker uses
// (config.go.hbs is only rendered once, at `create` — everything after that
// is a real file a human may have already edited).
export function patchConfigForAuth(configGoPath: string): void {
  let content = fs.readFileSync(configGoPath, "utf8");

  const fieldsBlock = [
    "JWTSecret string",
    "JWTAccessTTL time.Duration",
    "JWTRefreshTTL time.Duration",
    "CookieSecure bool",
    "CookieSameSite string",
    "",
    "PasswordResetTTL time.Duration",
    "PasswordResetURL string",
    "",
    "EmailVerifyTTL time.Duration",
    "EmailVerifyURL string",
    "",
    "GoogleClientID string",
    "GoogleClientSecret string",
    "GoogleRedirectURL string",
  ].join("\n");
  content = insertBeforeMarkerOnce(content, CONFIG_FIELDS_MARKER, fieldsBlock, "JWTSecret");

  const loadBlock = [
    'JWTSecret:     env("JWT_SECRET", "dev-secret-change-me"),',
    'JWTAccessTTL:  time.Duration(envInt("JWT_ACCESS_TTL_MIN", 15)) * time.Minute,',
    'JWTRefreshTTL: time.Duration(envInt("JWT_REFRESH_TTL_MIN", 43200)) * time.Minute,',
    'CookieSecure:  env("COOKIE_SECURE", "false") == "true",',
    'CookieSameSite: env("COOKIE_SAMESITE", "strict"),',
    "",
    'PasswordResetTTL: time.Duration(envInt("PASSWORD_RESET_TTL_MIN", 30)) * time.Minute,',
    'PasswordResetURL: env("PASSWORD_RESET_URL", "http://localhost:3000/reset-password"),',
    "",
    'EmailVerifyTTL: time.Duration(envInt("EMAIL_VERIFY_TTL_MIN", 1440)) * time.Minute,',
    'EmailVerifyURL: env("EMAIL_VERIFY_URL", "http://localhost:3000/verify-email"),',
    "",
    'GoogleClientID:     env("GOOGLE_CLIENT_ID", ""),',
    'GoogleClientSecret: env("GOOGLE_CLIENT_SECRET", ""),',
    'GoogleRedirectURL:  env("GOOGLE_REDIRECT_URL", ""),',
  ].join("\n");
  content = insertBeforeMarkerOnce(content, CONFIG_LOAD_MARKER, loadBlock, 'env("JWT_SECRET"');

  fs.writeFileSync(configGoPath, content);
}

// patchMainGoForAuth wires the user domain into cmd/api: its import, a
// queue.Client (needed for the forgot-password email — cmd/api itself never
// enqueued anything before this), its two models in the AutoMigrate call, a
// prod guard against the still-default JWT secret, and its route
// registration (the domain's own Handler.Register splits /auth public vs
// /users protected — main.go doesn't need to know that split, same
// convention as every other module).
export interface AuthWiring {
  goModule: string;
  /** which adapter `add worker` chose — decides how the enqueuer is built */
  queueBackend: QueueBackend;
  /** which store `add auth` chose — decides the token store and the limiter */
  store: AuthStore;
  /** whether the project has a queue to hand mail to */
  worker: boolean;
}

// authWiringLines is the single source of truth for the two lines that differ
// between stores, so patchMainGoForAuth and `add rbac`'s rewrite of the same
// lines can never drift apart.
export function authWiringLines(w: AuthWiring) {
  const postgres = w.store === "postgres";
  return {
    tokenStore: postgres ? "user.NewPgTokenStore(db)" : "user.NewRedisTokenStore(rdb)",
    limiter: postgres ? "middleware.NewMemoryLimiter()" : "middleware.NewRedisLimiter(rdb)",
    // with a queue the mail is enqueued and the request returns immediately;
    // without one it goes out inline, which is the cost of not running a worker
    mailer: w.worker ? "mail.NewAsyncClient(q)" : "mail.NewSyncClient(mail.Open(cfg))",
  };
}

export function patchMainGoForAuth(mainGoPath: string, w: AuthWiring): void {
  const { goModule, queueBackend, store } = w;
  let content = fs.readFileSync(mainGoPath, "utf8");

  const importLine = `"${goModule}/internal/app/user"`;
  content = insertBeforeMarkerOnce(content, IMPORT_MARKER, importLine, importLine);
  const modelImportLine = `usermodel "${goModule}/internal/app/user/model"`;
  content = insertBeforeMarkerOnce(content, IMPORT_MARKER, modelImportLine, modelImportLine);
  if (w.worker) {
    const queueImportLine = `"${goModule}/internal/platform/queue"`;
    content = insertBeforeMarkerOnce(content, IMPORT_MARKER, queueImportLine, queueImportLine);
  }
  const mailImportLine = `"${goModule}/internal/platform/mail"`;
  content = insertBeforeMarkerOnce(content, IMPORT_MARKER, mailImportLine, mailImportLine);

  const checkBlock = [
    'if cfg.IsProd() && cfg.JWTSecret == "dev-secret-change-me" {',
    '\treturn errors.New("JWT_SECRET is still the dev default — set a real secret before deploying with APP_ENV=production")',
    "}",
  ].join("\n");
  content = insertBeforeMarkerOnce(content, CONFIG_CHECKS_MARKER, checkBlock, "JWT_SECRET is still the dev default");

  // Without SMTP the mail client logs the message instead of sending it — a
  // deliberate dev convenience that in production means password-reset and
  // email-verification links land in the log aggregator while
  // /auth/forgot-password still answers 200, so nobody finds out the mail
  // never went anywhere.
  const smtpCheckBlock = [
    'if cfg.IsProd() && cfg.SMTPHost == "" {',
    '\treturn errors.New("SMTP_HOST is unset — password reset and email verification links would be written to the log instead of sent")',
    "}",
  ].join("\n");
  content = insertBeforeMarkerOnce(content, CONFIG_CHECKS_MARKER, smtpCheckBlock, "SMTP_HOST is unset");

  // The enqueuer is built from whatever backend `add worker` chose — the
  // constructor differs, everything downstream of it (mail.NewAsyncClient)
  // only sees the queue.Enqueuer interface and doesn't change.
  if (w.worker) {
    const queueCtor = queueBackend === "river" ? "queue.NewRiverEnqueuer(db)" : "queue.NewAsynqEnqueuer(cfg.RedisURL)";
    const queueInitBlock = [`q, err := ${queueCtor}`, "if err != nil {", '\treturn fmt.Errorf("open queue: %w", err)', "}"].join("\n");
    content = insertBeforeMarkerOnce(content, PLATFORM_INIT_MARKER, queueInitBlock, "q, err := queue.New");
  }

  const schemaBlock = [
    'if err := db.Exec("CREATE SCHEMA IF NOT EXISTS user_svc").Error; err != nil {',
    '\treturn fmt.Errorf("create schema user_svc: %w", err)',
    "}",
  ].join("\n");
  content = insertBeforeMarkerOnce(content, SCHEMA_MARKER, schemaBlock, "CREATE SCHEMA IF NOT EXISTS user_svc");

  const migrateLines = ["&usermodel.User{},", "&usermodel.Identity{},", "&usermodel.LoginThrottle{},"];
  // only the Postgres store has a table for AutoMigrate to create
  if (store === "postgres") migrateLines.push("&usermodel.AuthToken{},");
  for (const line of migrateLines) {
    content = insertBeforeMarkerOnce(content, MODEL_MARKER, line, line);
  }

  // same two-line shape every generated module uses: a named service, then
  // the handler that registers it. `add rbac` extends both lines later, and a
  // human wiring another domain into user's service edits line one in place.
  const { tokenStore, limiter, mailer } = authWiringLines(w);
  const svcLine = `userSvc := user.NewService(user.NewRepository(db), ${tokenStore}, ${mailer}, cfg)`;
  content = insertBeforeMarkerOnce(content, ROUTE_MARKER, svcLine, "userSvc :=");
  const routeLine = `user.NewHandler(userSvc, cfg.JWTSecret, cfg.JWTRefreshTTL, cfg.CookieSecure, cfg.CookieSameSite, ${limiter}).Register(api)`;
  content = insertBeforeMarkerOnce(content, ROUTE_MARKER, routeLine, routeLine);
  content = content.replace(/\n\t_ = api \/\/ dropped once `generate module` registers the first route\n/, "\n");

  if (w.worker) {
    const shutdownBlock = ["if err := q.Close(); err != nil {", '\tlogger.Error("close queue", "error", err)', "}"].join("\n");
    content = insertBeforeMarkerOnce(content, SHUTDOWN_MARKER, shutdownBlock, "if err := q.Close()");
  }

  fs.writeFileSync(mainGoPath, content);
}

// upgradeMailerToQueue is `add worker` arriving after `add auth`. Auth wired a
// synchronous mailer because there was no queue at the time; now there is one,
// so the enqueuer gets built and the mailer swapped for the async client.
//
// Without this the printed "run `add worker` later to move it onto the queue"
// would be a lie, and the project would keep blocking on SMTP with a perfectly
// good queue sitting next to it.
//
// No-op on a project whose auth already had a worker, and on one with no auth
// at all — both simply don't contain the line it looks for. Returns whether
// it actually upgraded something, so the caller's printed summary can say
// which happened instead of always assuming "no auth yet".
export function upgradeMailerToQueue(mainGoPath: string, goModule: string, queueBackend: QueueBackend): boolean {
  let content = fs.readFileSync(mainGoPath, "utf8");
  const syncMailer = "mail.NewSyncClient(mail.Open(cfg))";
  if (!content.includes(syncMailer)) return false;

  const queueImportLine = `"${goModule}/internal/platform/queue"`;
  content = insertBeforeMarkerOnce(content, IMPORT_MARKER, queueImportLine, queueImportLine);

  const queueCtor = queueBackend === "river" ? "queue.NewRiverEnqueuer(db)" : "queue.NewAsynqEnqueuer(cfg.RedisURL)";
  const queueInitBlock = [`q, err := ${queueCtor}`, "if err != nil {", '\treturn fmt.Errorf("open queue: %w", err)', "}"].join("\n");
  content = insertBeforeMarkerOnce(content, PLATFORM_INIT_MARKER, queueInitBlock, "q, err := queue.New");

  const shutdownBlock = ["if err := q.Close(); err != nil {", '\tlogger.Error("close queue", "error", err)', "}"].join("\n");
  content = insertBeforeMarkerOnce(content, SHUTDOWN_MARKER, shutdownBlock, "if err := q.Close()");

  content = content.replace(syncMailer, () => "mail.NewAsyncClient(q)");
  fs.writeFileSync(mainGoPath, content);
  return true;
}
