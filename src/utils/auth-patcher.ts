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
  content = insertBeforeMarkerOnce(content, CONFIG_FIELDS_MARKER, fieldsBlock, "JWTSecret string");

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
  content = insertBeforeMarkerOnce(content, CONFIG_LOAD_MARKER, loadBlock, 'JWTSecret:     env("JWT_SECRET"');

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
}

// authWiringLines is the single source of truth for the two lines that differ
// between stores, so patchMainGoForAuth and `add rbac`'s rewrite of the same
// lines can never drift apart.
export function authWiringLines(w: AuthWiring) {
  const postgres = w.store === "postgres";
  return {
    tokenStore: postgres ? "user.NewPgTokenStore(db)" : "user.NewRedisTokenStore(rdb)",
    limiter: postgres ? "middleware.NewMemoryLimiter()" : "middleware.NewRedisLimiter(rdb)",
  };
}

export function patchMainGoForAuth(mainGoPath: string, w: AuthWiring): void {
  const { goModule, queueBackend, store } = w;
  let content = fs.readFileSync(mainGoPath, "utf8");

  const importLine = `"${goModule}/internal/app/user"`;
  content = insertBeforeMarkerOnce(content, IMPORT_MARKER, importLine, importLine);
  const modelImportLine = `usermodel "${goModule}/internal/app/user/model"`;
  content = insertBeforeMarkerOnce(content, IMPORT_MARKER, modelImportLine, modelImportLine);
  const queueImportLine = `"${goModule}/internal/platform/queue"`;
  content = insertBeforeMarkerOnce(content, IMPORT_MARKER, queueImportLine, queueImportLine);
  const mailImportLine = `"${goModule}/internal/platform/mail"`;
  content = insertBeforeMarkerOnce(content, IMPORT_MARKER, mailImportLine, mailImportLine);

  const checkBlock = [
    'if cfg.IsProd() && cfg.JWTSecret == "dev-secret-change-me" {',
    '\tlogger.Error("JWT_SECRET is still the dev default — set a real secret before deploying with APP_ENV=production")',
    "\tos.Exit(1)",
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
    '\tlogger.Error("SMTP_HOST is unset — password reset and email verification links would be written to the log instead of sent")',
    "\tos.Exit(1)",
    "}",
  ].join("\n");
  content = insertBeforeMarkerOnce(content, CONFIG_CHECKS_MARKER, smtpCheckBlock, "SMTP_HOST is unset");

  // The enqueuer is built from whatever backend `add worker` chose — the
  // constructor differs, everything downstream of it (mail.NewAsyncClient)
  // only sees the queue.Enqueuer interface and doesn't change.
  const queueCtor = queueBackend === "river" ? "queue.NewRiverEnqueuer(db)" : "queue.NewAsynqEnqueuer(cfg.RedisURL)";
  const queueInitBlock = [`q, err := ${queueCtor}`, "if err != nil {", '\tlogger.Error("open queue", "error", err)', "\tos.Exit(1)", "}"].join("\n");
  content = insertBeforeMarkerOnce(content, PLATFORM_INIT_MARKER, queueInitBlock, "q, err := queue.New");

  const schemaBlock = [
    'if err := db.Exec("CREATE SCHEMA IF NOT EXISTS user_svc").Error; err != nil {',
    '\tlogger.Error("create schema", "error", err)',
    "\tos.Exit(1)",
    "}",
  ].join("\n");
  content = insertBeforeMarkerOnce(content, SCHEMA_MARKER, schemaBlock, "CREATE SCHEMA IF NOT EXISTS user_svc");

  const migrateLines = ["&usermodel.User{},", "&usermodel.Identity{},"];
  // only the Postgres store has a table for AutoMigrate to create
  if (store === "postgres") migrateLines.push("&usermodel.AuthToken{},");
  for (const line of migrateLines) {
    content = insertBeforeMarkerOnce(content, MODEL_MARKER, line, line);
  }

  // same two-line shape every generated module uses: a named service, then
  // the handler that registers it. `add rbac` extends both lines later, and a
  // human wiring another domain into user's service edits line one in place.
  const { tokenStore, limiter } = authWiringLines(w);
  const svcLine = `userSvc := user.NewService(user.NewRepository(db), ${tokenStore}, mail.NewAsyncClient(q), cfg)`;
  content = insertBeforeMarkerOnce(content, ROUTE_MARKER, svcLine, "userSvc :=");
  const routeLine = `user.NewHandler(userSvc, cfg.JWTSecret, cfg.JWTRefreshTTL, cfg.CookieSecure, cfg.CookieSameSite, ${limiter}).Register(api)`;
  content = insertBeforeMarkerOnce(content, ROUTE_MARKER, routeLine, routeLine);
  content = content.replace(/\n\t_ = api \/\/ dropped once `generate module` registers the first route\n/, "\n");

  const shutdownBlock = ["if err := q.Close(); err != nil {", '\tlogger.Error("close queue", "error", err)', "}"].join("\n");
  content = insertBeforeMarkerOnce(content, SHUTDOWN_MARKER, shutdownBlock, "if err := q.Close()");

  fs.writeFileSync(mainGoPath, content);
}
