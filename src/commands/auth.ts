import path from "path";
import fs from "fs-extra";
import pc from "picocolors";
import { readConfig, writeConfig } from "../utils/config";
import { applyTemplateEntries, gofmtTree } from "../utils/template-renderer";
import { authFiles } from "../templates/auth-manifest";
import { patchConfigForAuth, patchMainGoForAuth } from "../utils/auth-patcher";
import { AuthStore, BrowserTopology } from "../types";
import { patchCiForRedis, patchComposeForRedis, patchConfigForRedis, patchConfigForSMTP, patchMainGoForWorker } from "../utils/platform-patcher";
import { MAIL_CLIENT_ONLY } from "../templates/worker-manifest";
import { patchGolangciForModule } from "../utils/golangci-patcher";
import { newMigrationVersion } from "../utils/migrations";
import { patchOpenapiIndexRaw } from "../utils/openapi-patcher";
import { assertStillParses, parseChecks } from "../utils/gocheck";
import { patchGoModRequires } from "../utils/gomod-patcher";
import { DEFAULT_BROWSER_TOPOLOGY, validateBrowserTopology } from "../prompts/auth-wizard";

// URL (relative to the api prefix) -> docs file (relative to docs/) for every
// route `add auth` registers — kept next to AUTH_FILES's route list so the
// two are easy to eyeball together when a route changes.
const AUTH_OPENAPI_PATHS: { urlPath: string; file: string }[] = [
  { urlPath: "/auth/register", file: "./auth/register.yaml" },
  { urlPath: "/auth/login", file: "./auth/login.yaml" },
  { urlPath: "/auth/refresh", file: "./auth/refresh.yaml" },
  { urlPath: "/auth/logout", file: "./auth/logout.yaml" },
  { urlPath: "/auth/forgot-password", file: "./auth/forgot-password.yaml" },
  { urlPath: "/auth/reset-password", file: "./auth/reset-password.yaml" },
  { urlPath: "/auth/verify-email", file: "./auth/verify-email.yaml" },
  { urlPath: "/auth/{provider}/login", file: "./auth/provider-login.yaml" },
  { urlPath: "/auth/{provider}/exchange", file: "./auth/provider-exchange.yaml" },
  { urlPath: "/users/me", file: "./auth/users-me.yaml" },
  { urlPath: "/users/me/resend-verification", file: "./auth/users-me-resend-verification.yaml" },
  { urlPath: "/users/me/logout-all", file: "./auth/users-me-logout-all.yaml" },
  { urlPath: "/users/me/mfa", file: "./auth/users-me-mfa.yaml" },
  { urlPath: "/users/me/mfa/setup", file: "./auth/users-me-mfa-setup.yaml" },
  { urlPath: "/users/me/mfa/confirm", file: "./auth/users-me-mfa-confirm.yaml" },
  { urlPath: "/users/me/mfa/disable", file: "./auth/users-me-mfa-disable.yaml" },
  { urlPath: "/auth/mfa/verify", file: "./auth/mfa-verify.yaml" },
];

// addAuth scaffolds email/password authentication: a users+identities model
// pair, JWT access tokens, a selectable refresh token store with
// rotation + reuse detection, and register/login/refresh/logout/me. No RBAC
// (no roles/permissions) — that's a separate opt-in on top of this, since
// most projects need "is this caller logged in" long before they need "can
// this caller do X".
export async function addAuth(
  store: AuthStore = "postgres",
  projectDir: string = process.cwd(),
  browserTopology: BrowserTopology = DEFAULT_BROWSER_TOPOLOGY
): Promise<void> {
  const config = readConfig(projectDir);
  const browser = validateBrowserTopology(browserTopology);

  // No longer a prerequisite. Without a worker the verification and reset mail
  // goes out inline instead of through a queue — a real trade (those two
  // endpoints then block on SMTP), but not one worth forcing a second binary
  // and a queue-backend decision on someone who only wanted login.
  const worker = config.features.worker ?? false;

  const userDir = path.join(projectDir, "internal", "app", "user");
  if (fs.existsSync(userDir)) {
    throw new Error(`${userDir} already exists — auth looks like it's already been added`);
  }

  const parsedBefore = parseChecks(projectDir);

  // Only `--store redis` needs Redis. With `--store postgres` (the default)
  // auth adds no service at all — which is the whole point of the option.
  if (store === "redis") await ensureRedis(projectDir, config.goModule);

  // the SMTP client, and the config it reads, normally arrive with `add worker`
  if (!worker) {
    await applyTemplateEntries(projectDir, MAIL_CLIENT_ONLY, { goModule: config.goModule });
    patchConfigForSMTP(path.join(projectDir, "internal", "shared", "config", "config.go"));
    patchEnvExampleForSMTP(path.join(projectDir, ".env.example"));
  }

  await applyTemplateEntries(projectDir, authFiles(store), {
    goModule: config.goModule,
    redis: store === "redis",
    worker,
  });

  const migrationsDir = path.join(projectDir, "migrations");
  fs.ensureDirSync(migrationsDir);
  const usersVersion = newMigrationVersion(migrationsDir);
  await applyTemplateEntries(
    projectDir,
    [
      { template: "add/auth/migrations/create_users.up.sql.hbs", output: path.join("migrations", `${usersVersion}_create_users.up.sql`) },
      { template: "add/auth/migrations/create_users.down.sql.hbs", output: path.join("migrations", `${usersVersion}_create_users.down.sql`) },
    ],
    {}
  );

  const mfaVersion = newMigrationVersion(migrationsDir);
  await applyTemplateEntries(
    projectDir,
    [
      { template: "add/auth/migrations/create_mfa.up.sql.hbs", output: path.join("migrations", `${mfaVersion}_create_mfa.up.sql`) },
      { template: "add/auth/migrations/create_mfa.down.sql.hbs", output: path.join("migrations", `${mfaVersion}_create_mfa.down.sql`) },
    ],
    {}
  );
  // identities references users(id) — must apply strictly after it. A
  // second newMigrationVersion() call, scanning the dir again now that the
  // users pair is already written, guarantees a later (or same-second,
  // bumped) timestamp rather than assuming +1 by hand.
  const identitiesVersion = newMigrationVersion(migrationsDir);
  await applyTemplateEntries(
    projectDir,
    [
      { template: "add/auth/migrations/create_identities.up.sql.hbs", output: path.join("migrations", `${identitiesVersion}_create_identities.up.sql`) },
      { template: "add/auth/migrations/create_identities.down.sql.hbs", output: path.join("migrations", `${identitiesVersion}_create_identities.down.sql`) },
    ],
    {}
  );

  // the failed-attempt counter is not a store choice — lockout has to survive a
  // deploy and mean the same thing on every replica whichever store holds tokens
  const throttleVersion = newMigrationVersion(migrationsDir);
  await applyTemplateEntries(
    projectDir,
    [
      { template: "add/auth/migrations/create_login_throttle.up.sql.hbs", output: path.join("migrations", `${throttleVersion}_create_login_throttle.up.sql`) },
      { template: "add/auth/migrations/create_login_throttle.down.sql.hbs", output: path.join("migrations", `${throttleVersion}_create_login_throttle.down.sql`) },
    ],
    {}
  );

  // Recovery tokens are always stored in Postgres so consumption and the user
  // update can share one transaction, even when refresh rotation uses Redis.
  const authTokensVersion = newMigrationVersion(migrationsDir);
  await applyTemplateEntries(
    projectDir,
    [
      { template: "add/auth/migrations/create_auth_tokens.up.sql.hbs", output: path.join("migrations", `${authTokensVersion}_create_auth_tokens.up.sql`) },
      { template: "add/auth/migrations/create_auth_tokens.down.sql.hbs", output: path.join("migrations", `${authTokensVersion}_create_auth_tokens.down.sql`) },
    ],
    {}
  );

  // Only meaningful when there is a worker; readConfig fills this from the
  // adapter file on disk, so the only way it is still unknown is a project
  // that has internal/platform/queue with neither adapter in it. Guessing
  // here used to emit `queue.NewAsynqEnqueuer` into River-only projects —
  // an undefined symbol that the parse-only gate below cannot see, so the
  // command reported success over a project that no longer compiled.
  const queueBackend = config.features.queue;
  if (worker && !queueBackend) {
    throw new Error(
      "this project has internal/platform/queue but no river.go or asynq.go — can't tell which queue backend to wire auth's mailer onto.\n" +
        "Restore the adapter file, or remove internal/platform/queue and re-run `go-scaffold add worker`."
    );
  }

  patchGolangciForModule(path.join(projectDir, ".golangci.yml"), config.goModule, "user");
  patchConfigForAuth(path.join(projectDir, "internal", "shared", "config", "config.go"));
  patchMainGoForAuth(path.join(projectDir, "cmd", "api", "wiring.go"), {
    goModule: config.goModule,
    queueBackend: queueBackend ?? "river",
    store,
    worker,
  });
  patchGoModRequires(path.join(projectDir, "go.mod"), [
    "github.com/golang-jwt/jwt/v5 v5.3.1",
    "golang.org/x/crypto v0.52.0",
    "golang.org/x/oauth2 v0.36.0",
    // go-redis only when something in this project actually constructs a client
    ...(store === "redis" ? ["github.com/redis/go-redis/v9 v9.22.0"] : []),
  ]);
  patchEnvExample(path.join(projectDir, ".env.example"), browser);
  patchMakefile(path.join(projectDir, "Makefile"));

  let docsMessage = "";
  const openapiPath = path.join(projectDir, "docs", "openapi.yaml");
  if (config.features.openapiDocs && fs.existsSync(openapiPath)) {
    const docsEntries = [
      { template: "add/auth/docs/schemas.yaml.hbs", output: path.join("docs", "auth", "schemas.yaml") },
      ...AUTH_OPENAPI_PATHS.map(({ file }) => ({
        template: `add/auth/docs/${path.basename(file)}.hbs`,
        output: path.join("docs", "auth", path.basename(file)),
      })),
    ];
    await applyTemplateEntries(projectDir, docsEntries, {});
    patchOpenapiIndexRaw(openapiPath, config.apiPrefix, AUTH_OPENAPI_PATHS);
    docsMessage = "\ndocs: docs/auth/*.yaml, wired into docs/openapi.yaml";
  }

  gofmtTree(projectDir);
  // parse-only: jwt/oauth2/bcrypt aren't in go.mod until the `go mod tidy`
  // printed below, so `go vet` can't be the gate here.
  assertStillParses(projectDir, parsedBefore, "added auth");

  writeConfig(projectDir, { ...config, features: { ...config.features, auth: true, authStore: store } });

  console.log(pc.green("\nadded internal/app/user/, internal/shared/middleware/auth.go, and cmd/seed"));
  console.log(
    worker
      ? "verification + password-reset mail goes through the queue"
      : "verification + password-reset mail is sent inline (no worker) — run `add worker` later to move it onto the queue"
  );
  console.log(
    store === "postgres"
      ? "refresh + recovery tokens: Postgres (user_svc.auth_tokens), rate-limit counters in-process — no Redis"
      : "refresh tokens + rate-limit counters: Redis; recovery tokens: Postgres (user_svc.auth_tokens)"
  );
  console.log(
      "registered POST /auth/{register,login,refresh,logout,forgot-password,reset-password,verify-email}, " +
      "GET /auth/{provider}/login, POST /auth/{provider}/exchange, GET /users/me, and " +
      "POST /users/me/{resend-verification,logout-all,mfa/setup,mfa/confirm,mfa/disable}, " +
      "GET /users/me/mfa, and POST /auth/mfa/verify in cmd/api/wiring.go" +
      docsMessage
  );
  console.log(
    pc.dim(
      "\nnext: go mod tidy, then apply the new migrations with `make migrate-up` before production\n" +
        "seed an admin: SEED_ADMIN_EMAIL=... SEED_ADMIN_PASSWORD=... make seed"
    )
  );
}

function patchMakefile(makefilePath: string): void {
  if (!fs.existsSync(makefilePath)) return;
  let content = fs.readFileSync(makefilePath, "utf8");
  if (content.includes("\nseed:\n")) return; // already added

  // Both halves below have to land or neither should: .PHONY naming a target
  // that was never inserted is a Makefile that lies about itself. `build:` is
  // the anchor the target is inserted above, so check it first and bail whole.
  if (!/\nbuild:/.test(content)) {
    console.error(
      pc.yellow(`skipped the Makefile \`seed\` target — no \`build:\` target to anchor it to in ${makefilePath}.\nAdd it by hand: \`seed:\` running \`go run ./cmd/seed\`.`)
    );
    return;
  }

  content = content.replace(/^\.PHONY: /m, ".PHONY: seed ");

  const target =
    "\n# bootstrap an admin user (idempotent) — SEED_ADMIN_EMAIL/PASSWORD from the\n" +
    "# environment, not .env, so a real secret never sits in a checked-in file.\n" +
    "# --fixtures adds throwaway dev sample users, never use it outside dev.\n" +
    "seed:\n" +
    // `$$` throughout: make expands a single `$` as a variable reference, so
    // `$//` became `//` and left sed an unterminated s/// expression — the
    // recipe then failed, `.env` never loaded, and a bare `export` dumped the
    // whole environment. Matches every target in Makefile.hbs verbatim.
    "\t@set -a; [ -f $(ENV_FILE) ] && . ./$(ENV_FILE); set +a; go run ./cmd/seed $(ARGS)\n";

  // Function replacer — target contains a literal "$$", see worker.ts's
  // patchMakefile for why a string replacement would silently mangle it.
  content = content.replace(/\nbuild:/, () => `${target}\nbuild:`);
  fs.writeFileSync(makefilePath, content);
}

function patchEnvExample(envExamplePath: string, browserTopology: BrowserTopology): void {
  if (!fs.existsSync(envExamplePath)) return;
  let content = fs.readFileSync(envExamplePath, "utf8");
  if (content.includes("JWT_SECRET")) return; // already added

  content =
    content.replace(/\n?$/, "\n") +
    "\n# HS256 signing secret for access tokens — change this before deploying with APP_ENV=production\n" +
    "JWT_SECRET=dev-secret-change-me\n" +
    "JWT_ACCESS_TTL_MIN=15\n" +
    "JWT_REFRESH_TTL_MIN=43200\n" +
    "JWT_REFRESH_MAX_TTL_MIN=43200\n" +
    "OAUTH_STATE_TTL_MIN=10\n" +
    `COOKIE_SECURE=${browserTopology === "cross-site" ? "true" : "false"}\n` +
    "# strict | lax | none — the refresh cookie's SameSite. Keep strict while the\n" +
    "# frontend is the same site as this API (localhost:3000 -> localhost:8080 is,\n" +
    "# and so is app.example.com -> api.example.com). A frontend on a different\n" +
    "# site entirely needs none, together with COOKIE_SECURE=true, or the browser\n" +
    "# never sends the cookie to /auth/refresh and sessions die at every expiry.\n" +
    `COOKIE_SAMESITE=${browserTopology === "cross-site" ? "none" : "strict"}\n` +
    "\nPASSWORD_RESET_TTL_MIN=30\n" +
    "PASSWORD_RESET_URL=http://localhost:3000/reset-password\n" +
    "\nEMAIL_VERIFY_TTL_MIN=1440\n" +
    "EMAIL_VERIFY_URL=http://localhost:3000/verify-email\n" +
    "\n# leave the Google vars unset to disable Google login (register/login/refresh still work)\n" +
    "GOOGLE_CLIENT_ID=\n" +
    "GOOGLE_CLIENT_SECRET=\n" +
    "# exact browser callback URI registered with the provider (frontend-owned route)\n" +
    "GOOGLE_OAUTH_REDIRECT_URI=\n" +
    "\n# cookie/CORS deployment topology; the frontend owns its provider callback route\n" +
    `AUTH_BROWSER_TOPOLOGY=${browserTopology}\n` +
    "\n# MFA is globally off by default. When enabled, set a base64-encoded 32-byte\n" +
    "# AES-256 key (for example: openssl rand -base64 32). Users still opt in\n" +
    "# individually through /users/me/mfa/setup and /users/me/mfa/confirm.\n" +
    "AUTH_MFA_ENABLED=false\n" +
    "MFA_ISSUER=go-scaffold\n" +
    "MFA_ENCRYPTION_KEY=\n" +
    "MFA_CHALLENGE_TTL_MIN=5\n" +
    "MFA_TOTP_WINDOW=1\n" +
    "MFA_RECOVERY_CODE_COUNT=10\n";
  fs.writeFileSync(envExamplePath, content);
}

// ensureRedis adds internal/platform/cache + its config/env/main.go wiring
// when the project doesn't have Redis yet — which is the normal case once
// the queue lives in Postgres. Idempotent: a project whose queue is Redis
// already has all of this and nothing happens.
async function ensureRedis(projectDir: string, goModule: string): Promise<void> {
  const cacheGo = path.join(projectDir, "internal", "platform", "cache", "redis.go");
  if (fs.existsSync(cacheGo)) return;

  await applyTemplateEntries(
    projectDir,
    [{ template: "add/worker/internal/platform/cache/redis.go.hbs", output: "internal/platform/cache/redis.go" }],
    { goModule }
  );
  patchConfigForRedis(path.join(projectDir, "internal", "shared", "config", "config.go"));
  patchMainGoForWorker(path.join(projectDir, "cmd", "api", "wiring.go"), goModule);
  patchComposeForRedis(path.join(projectDir, "docker-compose.yml"));
  patchCiForRedis(path.join(projectDir, ".github", "workflows", "ci.yml"));

  const envExamplePath = path.join(projectDir, ".env.example");
  if (fs.existsSync(envExamplePath)) {
    const content = fs.readFileSync(envExamplePath, "utf8");
    if (!content.includes("REDIS_URL")) {
      fs.writeFileSync(envExamplePath, content.replace(/\n?$/, "\n") + "\n# refresh-token store\nREDIS_URL=redis://localhost:6379/0\n");
    }
  }
}

// patchEnvExampleForSMTP mirrors `add worker`'s own SMTP block, for the case
// where auth installed the mail client without a worker. Same append-once
// shape as every other env patcher.
function patchEnvExampleForSMTP(envExamplePath: string): void {
  if (!fs.existsSync(envExamplePath)) return;
  const content = fs.readFileSync(envExamplePath, "utf8");
  if (content.includes("SMTP_HOST")) return;
  fs.writeFileSync(
    envExamplePath,
    content.replace(/\n?$/, "\n") +
      "\n# leave SMTP_HOST unset to log emails instead of sending them (dev default)\n" +
      "SMTP_HOST=\n" +
      "SMTP_PORT=587\n" +
      "SMTP_USERNAME=\n" +
      "SMTP_PASSWORD=\n" +
      "SMTP_FROM=no-reply@example.local\n"
  );
}
