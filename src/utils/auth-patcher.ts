import fs from "fs-extra";
import { hasMarker, insertBeforeMarkerOnce } from "./marker-patch";
import { AuthStore } from "../types";

const IMPORT_MARKER = "// go-scaffold:imports";
const CONFIG_FIELDS_MARKER = "// go-scaffold:config-fields";
const CONFIG_LOAD_MARKER = "// go-scaffold:config-load";
const CONFIG_CHECKS_MARKER = "// go-scaffold:config-checks";
const SCHEMA_MARKER = "// go-scaffold:schemas";
const MODEL_MARKER = "// go-scaffold:models";
const ROUTE_MARKER = "// go-scaffold:routes";

// patchConfigForAuth adds JWT/cookie/password-reset/browser OAuth fields to
// Config, the same marker-based text insertion patchConfigForWorker uses
// (config.go.hbs is only rendered once, at `create` — everything after that
// is a real file a human may have already edited).
export function patchConfigForAuth(configGoPath: string): void {
  let content = fs.readFileSync(configGoPath, "utf8");

  const fieldsBlock = [
    "JWTSecret string",
    "AuthMetadataKey string",
    "JWTIssuer string",
    "JWTAudience string",
    "JWTAccessTTL time.Duration",
    "JWTRefreshTTL time.Duration",
    "JWTRefreshMaxTTL time.Duration",
    "OAuthStateTTL time.Duration",
    "CookieSecure bool",
    "CookieSameSite string",
    "AuthBrowserTopology string",
    "",
    "PasswordResetTTL time.Duration",
    "PasswordResetURL string",
    "",
    "EmailVerifyTTL time.Duration",
    "EmailVerifyURL string",
    "",
    "GoogleClientID string",
    "GoogleClientSecret string",
    "GoogleOAuthRedirectURI string",
    "GoogleOIDCMaxAuthAgeSec int",
    "GoogleOIDCRequiredACR string",
    "GoogleOIDCRequiredAMR string",
    "",
    "AuthMFAEnabled bool",
    "AuthMFARequiredForLogin bool",
    "MFAIssuer string",
    "MFAEncryptionKey string",
    "MFAChallengeTTL time.Duration",
    "MFATOTPWindow int",
    "MFARecoveryCodeCount int",
    "AuthMaxSessions int",
    "AuthCommonPasswordsFile string",
    "AuthContextPasswordsFile string",
    "AuthBreachedPasswordsFile string",
  ].join("\n");
  content = insertBeforeMarkerOnce(content, CONFIG_FIELDS_MARKER, fieldsBlock, "JWTSecret");

  const loadBlock = [
    'JWTSecret:     env("JWT_SECRET", "dev-secret-change-me"),',
    'AuthMetadataKey: env("AUTH_METADATA_KEY", "dev-metadata-key-change-me"),',
    'JWTIssuer:     env("JWT_ISSUER", "go-scaffold"),',
    'JWTAudience:   env("JWT_AUDIENCE", "api"),',
    'JWTAccessTTL:  time.Duration(envInt("JWT_ACCESS_TTL_MIN", 15)) * time.Minute,',
    'JWTRefreshTTL: time.Duration(envInt("JWT_REFRESH_TTL_MIN", 43200)) * time.Minute,',
    'JWTRefreshMaxTTL: time.Duration(envInt("JWT_REFRESH_MAX_TTL_MIN", 43200)) * time.Minute,',
    'OAuthStateTTL: time.Duration(envInt("OAUTH_STATE_TTL_MIN", 10)) * time.Minute,',
    'CookieSecure:  env("COOKIE_SECURE", "false") == "true",',
    'CookieSameSite: env("COOKIE_SAMESITE", "strict"),',
    'AuthBrowserTopology:    env("AUTH_BROWSER_TOPOLOGY", "same-site"),',
    "",
    'PasswordResetTTL: time.Duration(envInt("PASSWORD_RESET_TTL_MIN", 30)) * time.Minute,',
    'PasswordResetURL: env("PASSWORD_RESET_URL", "http://localhost:3000/reset-password"),',
    "",
    'EmailVerifyTTL: time.Duration(envInt("EMAIL_VERIFY_TTL_MIN", 1440)) * time.Minute,',
    'EmailVerifyURL: env("EMAIL_VERIFY_URL", "http://localhost:3000/verify-email"),',
    "",
    'GoogleClientID:     env("GOOGLE_CLIENT_ID", ""),',
    'GoogleClientSecret: env("GOOGLE_CLIENT_SECRET", ""),',
    'GoogleOAuthRedirectURI: env("GOOGLE_OAUTH_REDIRECT_URI", ""),',
    'GoogleOIDCMaxAuthAgeSec: envInt("GOOGLE_OIDC_MAX_AGE_SEC", 0),',
    'GoogleOIDCRequiredACR: env("GOOGLE_OIDC_REQUIRED_ACR", ""),',
    'GoogleOIDCRequiredAMR: env("GOOGLE_OIDC_REQUIRED_AMR", ""),',
    "",
    'AuthMFAEnabled: env("AUTH_MFA_ENABLED", "false") == "true",',
    'AuthMFARequiredForLogin: env("AUTH_MFA_REQUIRED_FOR_LOGIN", "false") == "true",',
    'MFAIssuer: env("MFA_ISSUER", "go-scaffold"),',
    'MFAEncryptionKey: env("MFA_ENCRYPTION_KEY", ""),',
    'MFAChallengeTTL: time.Duration(envInt("MFA_CHALLENGE_TTL_MIN", 5)) * time.Minute,',
    'MFATOTPWindow: envInt("MFA_TOTP_WINDOW", 1),',
    'MFARecoveryCodeCount: envInt("MFA_RECOVERY_CODE_COUNT", 10),',
    'AuthMaxSessions: envInt("AUTH_MAX_SESSIONS", 10),',
    'AuthCommonPasswordsFile: env("AUTH_COMMON_PASSWORDS_FILE", ""),',
    'AuthContextPasswordsFile: env("AUTH_CONTEXT_PASSWORDS_FILE", ""),',
    'AuthBreachedPasswordsFile: env("AUTH_BREACHED_PASSWORDS_FILE", ""),',
  ].join("\n");
  content = insertBeforeMarkerOnce(content, CONFIG_LOAD_MARKER, loadBlock, 'env("JWT_SECRET"');

  fs.writeFileSync(configGoPath, content);
}

// patchMainGoForAuth wires the user domain into cmd/api: its import, optional
// models in a legacy development bootstrap, a
// prod guard against the still-default JWT secret, and its route
// registration (the domain's own Handler.Register splits /auth public vs
// /users protected — main.go doesn't need to know that split, same
// convention as every other module).
export interface AuthWiring {
  goModule: string;
  /** which store `add auth` chose — decides the token store and the limiter */
  store: AuthStore;
}

// authHandlerLineFor is the one root-level auth route shape. The feature owns
// construction; wiring.go only hands it shared infrastructure and, when RBAC
// is present, the role feature's public capabilities.
export function authSessionValidatorLine(w: AuthWiring): string {
  const args = ["db", "cfg"];
  if (w.store === "redis") args.push("rdb");
  return `sessionValidator := user.NewSessionValidatorFromDB(${args.join(", ")})`;
}

export function authHandlerLineFor(w: AuthWiring, roleDependencies: [string, string] = ["nil", "nil"]): string {
  const args = ["db", "cfg"];
  if (w.store === "redis") args.push("rdb");
  args.push(...roleDependencies);
  return `user.NewHandlerFromDB(${args.join(", ")}).Register(api)`;
}

export function patchMainGoForAuth(mainGoPath: string, w: AuthWiring): void {
  const { goModule, store } = w;
  let content = fs.readFileSync(mainGoPath, "utf8");

  const importLine = `"${goModule}/internal/app/user"`;
  content = insertBeforeMarkerOnce(content, IMPORT_MARKER, importLine, importLine);
  content = insertBeforeMarkerOnce(content, IMPORT_MARKER, `"net/url"`, `"net/url"`);
  const modelImportLine = `usermodel "${goModule}/internal/app/user/adapters/outbound/postgres"`;
  // Only the development AutoMigrate list ever used this alias, so it is only
  // an import where that list still exists — see the guard further down.
  if (hasMarker(content, MODEL_MARKER)) {
    content = insertBeforeMarkerOnce(content, IMPORT_MARKER, modelImportLine, modelImportLine);
  }
  const checkBlock = [
    'if os.Getenv("APP_ENV") == "" {',
    '\treturn errors.New("APP_ENV must be set explicitly for auth-enabled projects (use development locally or production when deployed)")',
    "}",
    'if cfg.IsProd() && cfg.JWTSecret == "dev-secret-change-me" {',
    '\treturn errors.New("JWT_SECRET is still the dev default — set a real secret before deploying with APP_ENV=production")',
    "}",
    'if cfg.IsProd() && len([]byte(cfg.JWTSecret)) < 32 {',
    '\treturn errors.New("JWT_SECRET must be at least 32 bytes before deploying with APP_ENV=production")',
    "}",
    'if cfg.JWTIssuer == "" || cfg.JWTAudience == "" {',
    '\treturn errors.New("JWT_ISSUER and JWT_AUDIENCE must be configured")',
    "}",
    'if cfg.IsProd() && (cfg.JWTIssuer == "go-scaffold" || cfg.JWTAudience == "api") {',
    '\treturn errors.New("JWT_ISSUER and JWT_AUDIENCE must be changed from their development defaults before deploying with APP_ENV=production")',
    "}",
    'if cfg.IsProd() && cfg.AuthMetadataKey == "dev-metadata-key-change-me" {',
    '\treturn errors.New("AUTH_METADATA_KEY is still the dev default — set a separate key before deploying with APP_ENV=production")',
    "}",
    'if cfg.IsProd() && len([]byte(cfg.AuthMetadataKey)) < 32 {',
    '\treturn errors.New("AUTH_METADATA_KEY must be at least 32 bytes before deploying with APP_ENV=production")',
    "}",
    'if cfg.IsProd() && cfg.AuthMetadataKey == cfg.JWTSecret {',
    '\treturn errors.New("AUTH_METADATA_KEY must be different from JWT_SECRET before deploying with APP_ENV=production")',
    "}",
    'for _, endpoint := range []struct { name, value string }{{"PASSWORD_RESET_URL", cfg.PasswordResetURL}, {"EMAIL_VERIFY_URL", cfg.EmailVerifyURL}} {',
    '\tu, err := url.Parse(endpoint.value)',
    '\tif err != nil || !u.IsAbs() || u.Host == "" || (u.Scheme != "http" && u.Scheme != "https") {',
    '\t\treturn fmt.Errorf("%s must be an absolute http(s) URL; set it in the deployment environment", endpoint.name)',
    '\t}',
    '\tif cfg.IsProd() && u.Scheme != "https" {',
    '\t\treturn fmt.Errorf("%s must use https:// when APP_ENV=production", endpoint.name)',
    '\t}',
    '}',
  ].join("\n");
  content = insertBeforeMarkerOnce(content, CONFIG_CHECKS_MARKER, checkBlock, "JWT_SECRET is still the dev default");

  // Without SMTP the mail client logs only metadata instead of sending — a
  // deliberate dev convenience that in production would silently drop
  // password-reset and email-verification mail while /auth/forgot-password
  // still answers 200. Refuse that configuration at boot.
  const smtpCheckBlock = [
    'if cfg.IsProd() && cfg.SMTPHost == "" {',
    '\treturn errors.New("SMTP_HOST is unset — password reset and email verification mail would not be sent")',
    "}",
  ].join("\n");
  content = insertBeforeMarkerOnce(content, CONFIG_CHECKS_MARKER, smtpCheckBlock, "SMTP_HOST is unset");

  const mfaCheckBlock = [
    "if cfg.AuthMFAEnabled {",
    "\tif err := user.ValidateMFASettings(user.MFASettings{",
    "\t\tEnabled: cfg.AuthMFAEnabled,",
    "\t\tIssuer: cfg.MFAIssuer,",
    "\t\tEncryptionKey: cfg.MFAEncryptionKey,",
    "\t\tChallengeTTL: cfg.MFAChallengeTTL,",
    "\t\tTOTPWindow: cfg.MFATOTPWindow,",
    "\t\tRecoveryCodeCount: cfg.MFARecoveryCodeCount,",
    "\t}); err != nil {",
    "\t\treturn fmt.Errorf(\"invalid MFA configuration: %w\", err)",
    "\t}",
    "}",
  ].join("\n");
  content = insertBeforeMarkerOnce(content, CONFIG_CHECKS_MARKER, mfaCheckBlock, "invalid MFA configuration");

  const sessionCheckBlock = [
    "if cfg.JWTAccessTTL <= 0 {",
    '\treturn fmt.Errorf("JWT_ACCESS_TTL_MIN must be positive")',
    "}",
    "if cfg.JWTRefreshTTL <= 0 || cfg.JWTRefreshMaxTTL <= 0 {",
    '\treturn fmt.Errorf("JWT refresh token lifetimes must be positive")',
    "}",
    "if cfg.JWTRefreshMaxTTL < cfg.JWTRefreshTTL {",
    '\treturn fmt.Errorf("JWT_REFRESH_MAX_TTL_MIN must be greater than or equal to JWT_REFRESH_TTL_MIN")',
    "}",
    "if cfg.AuthMaxSessions < 1 || cfg.AuthMaxSessions > 100 {",
    '\treturn fmt.Errorf("AUTH_MAX_SESSIONS must be between 1 and 100")',
    "}",
  ].join("\n");
  content = insertBeforeMarkerOnce(content, CONFIG_CHECKS_MARKER, sessionCheckBlock, "JWT_ACCESS_TTL_MIN must be positive");

  const schemaBlock = [
    'if err := db.Exec("CREATE SCHEMA IF NOT EXISTS user_svc").Error; err != nil {',
    '\treturn fmt.Errorf("create schema user_svc: %w", err)',
    "}",
  ].join("\n");
  // The development AutoMigrate bootstrap is gone from the template, and with
  // it the schema/model markers. A project scaffolded before that still has
  // them, and still wants its tables registered there — so these stay, guarded
  // by the marker's presence rather than deleted. New projects skip them.
  if (hasMarker(content, SCHEMA_MARKER)) {
    content = insertBeforeMarkerOnce(content, SCHEMA_MARKER, schemaBlock, "CREATE SCHEMA IF NOT EXISTS user_svc");
  }

  const migrateLines = [
    "&usermodel.User{},",
    "&usermodel.UserEmail{},",
    "&usermodel.PasswordCredential{},",
    "&usermodel.ExternalIdentity{},",
    "&usermodel.LoginThrottle{},",
  ];
  // Recovery tokens are always durable in Postgres, even when refresh tokens
  // live in Redis, so reset/verification can share the user transaction.
  migrateLines.push("&usermodel.AuthToken{},");
  migrateLines.push("&usermodel.MFAEnrollment{},", "&usermodel.MFAChallenge{},", "&usermodel.MFARecoveryCode{},");
  if (hasMarker(content, MODEL_MARKER)) {
    for (const line of migrateLines) {
      content = insertBeforeMarkerOnce(content, MODEL_MARKER, line, line);
    }
  }

  // Keep auth construction inside the feature package. The root only chooses
  // shared infrastructure and registers the resulting handler.
  const routeLine = authHandlerLineFor(w);
  content = insertBeforeMarkerOnce(content, ROUTE_MARKER, routeLine, routeLine);
  content = content.replace(/\n\t_ = api \/\/ dropped once `generate module` registers the first route\n/, "\n");

  fs.writeFileSync(mainGoPath, content);
}
