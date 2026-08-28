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

  const handler = read(project, "internal", "app", "user", "handler.go");
  const service = read(project, "internal", "app", "user", "service.go");
  const googleProvider = read(project, "internal", "platform", "authprovider", "google", "google.go");
  const composition = read(project, "internal", "app", "user", "composition.go");
  const config = read(project, "internal", "shared", "config", "config.go");
  const env = read(project, ".env.example");
  const openapi = read(project, "docs", "openapi.yaml");

  assert.match(handler, /GET\("\/:provider\/login", h\.providerLogin\)/);
  assert.match(handler, /POST\("\/:provider\/exchange", h\.providerExchange\)/);
  assert.doesNotMatch(handler, /providerCallback|StatusSeeOther|RedirectTarget/);
  assert.doesNotMatch(service, /oauth2\.Config|GoogleLoginURL|GoogleCallback|findOrCreateGoogleUser|issueOAuthState/);
  assert.match(service, /validPKCEChallenge\(in\.CodeChallenge\)/);
  assert.match(service, /in\.CodeChallengeMethod != "S256"/);
  assert.doesNotMatch(service, /TrimSpace\(in\.(State|Code|CodeVerifier|CodeChallenge)/);
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
  assert.match(read(project, "internal", "app", "user", "service.go"), /ConsumeLoginTransaction/);
  assert.match(read(project, "internal", "app", "user", "handler.go"), /Cache-Control/);
  assert.match(read(project, "docs", "auth", "provider-exchange.yaml"), /providerExchange/);
  assert.match(read(project, "docs", "auth", "provider-login.yaml"), /minLength: 43/);
  assert.match(read(project, "docs", "auth", "schemas.yaml"), /code_verifier:[\s\S]*minLength: 43/);
  assert.equal(existsSync(path.join(project, "docs", "auth", "provider-callback.yaml")), false);
  assert.ok(existsSync(path.join(project, "internal", "app", "user", "application", "oauth.go")));
  assert.ok(existsSync(path.join(project, "internal", "platform", "authprovider", "google", "google.go")));
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
