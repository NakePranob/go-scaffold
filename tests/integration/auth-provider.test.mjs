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

function cliFailure(cwd, ...args) {
  assert.throws(
    () => cli(cwd, ...args),
    (err) => /Browser topology|unknown/i.test(String(err.stdout ?? "") + String(err.stderr ?? "") + String(err.message)),
  );
}

function createProject(t, name = "app") {
  const dir = mkdtempSync(path.join(tmpdir(), "go-scaffold-provider-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  cli(dir, "create", name, "--defaults", "--no-docker");
  return path.join(dir, name);
}

const read = (project, ...parts) => readFileSync(path.join(project, ...parts), "utf8");

test("add auth writes generic provider login and exchange routes", (t) => {
  const project = createProject(t);
  cli(project, "add", "auth", "--store", "postgres", "--browser-topology", "same-site", "--yes");

  const application = ["internal", "app", "user", "application"];
  const inbound = ["internal", "app", "user", "adapters", "inbound", "http"];
  const postgres = ["internal", "app", "user", "adapters", "outbound", "postgres"];
  const handler = read(project, ...inbound, "handler.go");
  const identityHandler = read(project, ...inbound, "handler_identity.go");
  const service = read(project, ...application, "service.go");
  const identities = read(project, ...application, "identities.go");
  const applicationDTO = read(project, ...application, "dto.go");
  const contracts = read(project, ...application, "contracts.go");
  const passwordPorts = read(project, "internal", "app", "user", "ports", "password.go");
  const passwordAdapter = read(project, "internal", "app", "user", "adapters", "outbound", "password", "bcrypt.go");
  const mfaService = read(project, ...application, "mfa_service.go");
  const mfaStore = read(project, ...postgres, "mfa_store.go");
  const externalLogin = read(project, ...application, "external_login.go");
  const sessionCookie = read(project, ...inbound, "session_cookie.go");
  const browserPolicy = read(project, ...inbound, "browser_policy.go");
  const googleProvider = read(project, "internal", "platform", "authprovider", "google", "google.go");
  const postgresModel = read(project, ...postgres, "model.go");
  const migrations = execFileSync("ls", [path.join(project, "migrations")], { encoding: "utf8" });
  const composition = read(project, "internal", "app", "user", "composition.go");
  const config = read(project, "internal", "shared", "config", "config.go");
  const env = read(project, ".env.example");
  const openapi = read(project, "docs", "openapi.yaml");

  assert.match(handler, /GET\("\/:provider\/login", h\.providerLogin\)/);
  assert.match(handler, /POST\("\/:provider\/exchange", h\.providerExchange\)/);
  assert.match(handler, /GET\("\/me\/sessions", h\.sessions\)/);
  assert.match(handler, /DELETE\("\/me\/sessions\/:id", h\.revokeSession\)/);
  assert.match(identityHandler, /GET\("\/me\/identities", h\.listIdentities\)/);
  assert.match(identityHandler, /POST\("\/me\/identities\/local", linkLimiter, h\.linkLocalIdentity\)/);
  assert.match(identityHandler, /POST\("\/me\/identities\/:provider\/link", linkLimiter, h\.beginIdentityLink\)/);
  assert.match(identityHandler, /POST\("\/me\/identities\/:provider\/link\/exchange", linkLimiter, h\.exchangeIdentityLink\)/);
  assert.match(identityHandler, /DELETE\("\/me\/identities\/:provider", h\.unlinkIdentity\)/);
  assert.match(identities, /func \(s \*Service\) ExchangeIdentityLink\(/);
  assert.match(identities, /func \(s \*Service\) LinkLocalIdentity\(/);
  assert.match(postgresModel, /type UserEmail struct/);
  assert.match(postgresModel, /type PasswordCredential struct/);
  assert.match(postgresModel, /type ExternalIdentity struct/);
  assert.match(postgresModel, /Issuer\s+string[^\n]*type:text/);
  assert.match(postgresModel, /UserID\s+uuid\.UUID[^\n]*uniqueIndex:idx_user_emails_primary,where:is_primary/);
  assert.doesNotMatch(postgresModel, /IsPrimary\s+bool[^\n]*uniqueIndex:idx_user_emails_primary/);
  assert.doesNotMatch(postgresModel, /type Identity struct/);
  assert.match(migrations, /_create_user_emails\.up\.sql/);
  assert.match(migrations, /_create_password_credentials\.up\.sql/);
  assert.match(migrations, /_create_external_identities\.up\.sql/);
  assert.doesNotMatch(migrations, /_create_identities\.up\.sql/);
  const userEmailsMigration = readFileSync(
    path.join(project, "migrations", migrations.split("\n").find((file) => file.includes("_create_user_emails.up.sql"))),
    "utf8",
  );
  assert.match(userEmailsMigration, /CREATE UNIQUE INDEX idx_user_emails_primary ON user_svc\.user_emails \(user_id\) WHERE is_primary;/);
  assert.match(read(project, ...application, "identities_test.go"), /AUTH_LAST_IDENTITY/);
  assert.doesNotMatch(handler, /providerCallback|StatusSeeOther|RedirectTarget/);
  assert.doesNotMatch(service, /oauth2\.Config|GoogleLoginURL|GoogleCallback|findOrCreateGoogleUser|issueOAuthState/);
  assert.match(service, /func NewService\(deps Dependencies, cfg AuthConfig\)/);
  assert.doesNotMatch(service, /config\.Config/);
  assert.doesNotMatch(applicationDTO, /json:/);
  assert.match(contracts, /type Dependencies struct/);
  assert.match(contracts, /type AuthConfig struct/);
  assert.match(contracts, /MFA\s+ports\.MFAStore/);
  assert.match(contracts, /Passwords\s+ports\.PasswordHasher/);
  assert.match(passwordPorts, /type PasswordHasher interface/);
  assert.match(passwordAdapter, /var _ userports\.PasswordHasher/);
  assert.doesNotMatch(read(project, ...application, "local_auth.go"), /x\/crypto\/bcrypt/);
  assert.doesNotMatch(read(project, ...application, "user_query.go"), /x\/crypto\/bcrypt/);
  assert.match(contracts, /type MFASettings/);
  assert.match(read(project, "internal", "app", "user", "application", "oauth.go"), /type ProviderRegistry struct/);
  assert.match(mfaService, /totpCode/);
  assert.match(mfaStore, /ConsumeChallenge/);
  assert.match(externalLogin, /validPKCEChallenge\(in\.CodeChallenge\)/);
  assert.match(externalLogin, /in\.CodeChallengeMethod != "S256"/);
  assert.doesNotMatch(externalLogin, /TrimSpace\(in\.(State|Code|CodeVerifier|CodeChallenge)/);
  assert.match(googleProvider, /validPKCEValue\(in\.CodeChallenge\)/);
  assert.match(googleProvider, /validPKCEValue\(in\.CodeVerifier\)/);
  assert.doesNotMatch(googleProvider, /TrimSpace\(in\.(Code|CodeVerifier)/);
  assert.match(composition, /application\.NewProviderRegistry/);
  assert.match(composition, /authprovider\/google/);
  assert.match(composition, /NewHandlerWithOrigins/);
  assert.match(config, /GOOGLE_OAUTH_REDIRECT_URI/);
  assert.match(config, /AUTH_BROWSER_TOPOLOGY/);
  assert.match(config, /JWT_REFRESH_MAX_TTL_MIN/);
  assert.match(config, /OAUTH_STATE_TTL_MIN/);
  assert.match(config, /AUTH_MFA_ENABLED/);
  assert.match(env, /^AUTH_MFA_ENABLED=false$/m);
  assert.match(env, /^MFA_TOTP_WINDOW=1$/m);
  assert.doesNotMatch(config, /AUTH_FRONTEND_SUCCESS_URL|AUTH_FRONTEND_ERROR_URL|AuthFrontend|RedirectTarget/);
  assert.doesNotMatch(config, /https:\/\/app\.example\.com/);
  assert.match(env, /^GOOGLE_OAUTH_REDIRECT_URI=$/m);
  assert.match(env, /^AUTH_BROWSER_TOPOLOGY=same-site$/m);
  assert.match(env, /^JWT_REFRESH_MAX_TTL_MIN=43200$/m);
  assert.match(env, /^OAUTH_STATE_TTL_MIN=10$/m);
  assert.doesNotMatch(env, /AUTH_FRONTEND_SUCCESS_URL|AUTH_FRONTEND_ERROR_URL|GOOGLE_REDIRECT_URL/);
  assert.match(openapi, /\/auth\/\{provider\}\/login:/);
  assert.match(openapi, /\/auth\/\{provider\}\/exchange:/);
  assert.doesNotMatch(openapi, /\/auth\/\{provider\}\/callback:/);
  assert.match(externalLogin, /ConsumeLoginTransaction/);
  assert.match(sessionCookie, /Cache-Control/);
  assert.match(browserPolicy, /requireBrowserOrigin/);
  assert.match(read(project, "docs", "auth", "provider-exchange.yaml"), /providerExchange/);
  assert.match(read(project, "docs", "auth", "provider-login.yaml"), /minLength: 43/);
  assert.match(read(project, "docs", "auth", "users-me-sessions.yaml"), /listMySessions/);
  assert.match(read(project, "docs", "auth", "users-me-session.yaml"), /revokeMySession/);
  assert.match(read(project, "docs", "auth", "users-me-identities.yaml"), /listMyIdentities/);
  assert.match(read(project, "docs", "auth", "users-me-identity-local-link.yaml"), /linkMyLocalIdentity/);
  assert.match(read(project, "docs", "auth", "users-me-identity-link.yaml"), /startIdentityLink/);
  assert.match(read(project, "docs", "auth", "users-me-identity-link-exchange.yaml"), /exchangeIdentityLink/);
  assert.match(read(project, "docs", "auth", "users-me-identity.yaml"), /unlinkMyIdentity/);
  assert.match(read(project, "docs", "auth", "schemas.yaml"), /SessionResponse:/);
  assert.match(read(project, "docs", "auth", "schemas.yaml"), /IdentityResponse:/);
  assert.match(read(project, "docs", "auth", "schemas.yaml"), /code_verifier:[\s\S]*minLength: 43/);
  assert.equal(existsSync(path.join(project, "docs", "auth", "provider-callback.yaml")), false);
  assert.ok(existsSync(path.join(project, "internal", "app", "user", "application", "oauth.go")));
  assert.ok(existsSync(path.join(project, "internal", "app", "user", "adapters", "inbound", "http", "handler.go")));
  assert.ok(existsSync(path.join(project, "internal", "app", "user", "adapters", "inbound", "http", "handler_identity.go")));
  assert.ok(existsSync(path.join(project, "internal", "app", "user", "application", "identities.go")));
  assert.ok(existsSync(path.join(project, "internal", "app", "user", "ports", "repository.go")));
  assert.ok(existsSync(path.join(project, "internal", "platform", "authprovider", "google", "google.go")));
  for (const file of [
    "local_auth.go",
    "sessions.go",
    "recovery_service.go",
    "external_login.go",
    "identities.go",
    "user_query.go",
    "handler_local.go",
    "handler_recovery.go",
    "handler_oauth.go",
    "handler_user.go",
    "session_cookie.go",
    "browser_policy.go",
    "contracts.go",
    "mfa_service.go",
    "mfa_store.go",
    "mfa_store_test.go",
    "handler_mfa.go",
    "handler_identity.go",
  ]) {
    const directory = ["handler_local.go", "handler_recovery.go", "handler_oauth.go", "handler_user.go", "handler_mfa.go", "handler_identity.go", "session_cookie.go", "browser_policy.go"].includes(file)
      ? inbound
      : ["mfa_store.go", "mfa_store_test.go"].includes(file)
        ? postgres
        : application;
    assert.ok(existsSync(path.join(project, ...directory, file)), `${file} must be generated in the canonical split boundary`);
  }
  assert.equal(existsSync(path.join(project, "internal", "app", "user", "model")), false);
});

test("add auth --defaults keeps local same-site defaults and --yes remains non-TTY safe", (t) => {
  const project = createProject(t);
  cli(project, "add", "auth", "--store", "postgres", "--yes");
  const env = read(project, ".env.example");
  assert.match(env, /^GOOGLE_OAUTH_REDIRECT_URI=$/m);
  assert.match(env, /^AUTH_BROWSER_TOPOLOGY=same-site$/m);
  assert.match(env, /^COOKIE_SECURE=false$/m);
  assert.match(env, /^COOKIE_SAMESITE=strict$/m);
});

test("add auth --store redis keeps identity linking compilable", (t) => {
  const project = createProject(t, "redis-auth-app");
  cli(project, "add", "auth", "--store", "redis", "--yes");
  execFileSync("go", ["mod", "tidy"], { cwd: project, stdio: "ignore" });
  execFileSync("go", ["test", "./..."], { cwd: project, stdio: "ignore" });

  assert.match(read(project, "internal", "app", "user", "adapters", "outbound", "redis", "tokenstore.go"), /LoginTransaction/);
  assert.ok(existsSync(path.join(project, "internal", "app", "user", "application", "identities_test.go")));
});

test("cross-site topology emits the required None + Secure cookie defaults", (t) => {
  const project = createProject(t);
  cli(project, "add", "auth", "--defaults", "--browser-topology", "cross-site");
  const env = read(project, ".env.example");
  assert.match(env, /^AUTH_BROWSER_TOPOLOGY=cross-site$/m);
  assert.match(env, /^COOKIE_SECURE=true$/m);
  assert.match(env, /^COOKIE_SAMESITE=none$/m);
});

test("browser topology rejects unsupported values", (t) => {
  const project = createProject(t, "topology-app");
  cliFailure(project, "add", "auth", "--browser-topology", "embedded-webview", "--defaults", "--yes");
});

test("add auth help exposes topology without server frontend URL flags", () => {
  const help = execFileSync("node", [CLI, "add", "auth", "--help"], { encoding: "utf8" });
  assert.match(help, /--browser-topology <topology>/);
  assert.doesNotMatch(help, /--frontend-success-url|--frontend-error-url/);
});

test("generate method remains usable after auth splits its service and handler files", (t) => {
  const project = createProject(t, "auth-method-app");
  cli(project, "add", "auth", "--store", "postgres", "--yes");

  const listOutput = cli(project, "generate", "method", "user", "lookupByEmail", "--type", "get", "--get-mode", "all");
  const lookupOutput = cli(project, "generate", "method", "user", "findByName", "--type", "get", "--get-mode", "one", "--field", "name");
  execFileSync("go", ["mod", "tidy"], { cwd: project, stdio: "ignore" });
  execFileSync("go", ["test", "./..."], { cwd: project, stdio: "ignore" });

  const handler = read(project, "internal", "app", "user", "adapters", "inbound", "http", "handler.go");
  const service = read(project, "internal", "app", "user", "application", "service.go");
  const repository = read(project, "internal", "app", "user", "adapters", "outbound", "postgres", "repository.go");
  const serviceTest = read(project, "internal", "app", "user", "application", "service_test.go");

  assert.match(listOutput, /route: GET \/users\/lookup-by-email/);
  assert.match(listOutput, /next: fill in the TODO in application\/service\.go/);
  assert.match(lookupOutput, /route: GET \/users\/name\/\{name\}/);
  assert.match(handler, /usersGroup\.GET\("\/lookup-by-email", h\.lookupByEmail\)/);
  assert.match(handler, /usersGroup\.GET\("\/name\/:name", h\.findByName\)/);
  assert.match(service, /func \(s \*Service\) LookupByEmail\(/);
  assert.match(service, /func \(s \*Service\) FindByName\(/);
  assert.match(repository, /func \(r \*Repository\) FindByName\(/);
  assert.match(repository, /r\.toDomainUser\(ctx, &row\)/);
  assert.match(serviceTest, /func \(f \*fakeRepo\) FindByName\(/);
  assert.ok(existsSync(path.join(project, "migrations")));
});
