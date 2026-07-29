import path from "path";
import fs from "fs-extra";
import pc from "picocolors";
import { readConfig, writeConfig } from "../utils/config";
import { applyTemplateEntries, gofmtTree } from "../utils/template-renderer";
import { AUTH_FILES } from "../templates/auth-manifest";
import { patchConfigForAuth, patchMainGoForAuth } from "../utils/auth-patcher";
import { newMigrationVersion } from "../utils/migrations";

// addAuth scaffolds email/password authentication: a users+identities model
// pair, JWT access tokens, a Redis-backed refresh token store with
// rotation + reuse detection, and register/login/refresh/logout/me. No RBAC
// (no roles/permissions) — that's a separate opt-in on top of this, since
// most projects need "is this caller logged in" long before they need "can
// this caller do X".
export async function addAuth(projectDir: string = process.cwd()): Promise<void> {
  const config = readConfig(projectDir);

  if (!config.features.worker) {
    throw new Error("`go-scaffold add auth` requires `go-scaffold add worker` first — the refresh token store needs Redis");
  }

  const userDir = path.join(projectDir, "internal", "app", "user");
  if (fs.existsSync(userDir)) {
    throw new Error(`${userDir} already exists — auth looks like it's already been added`);
  }

  await applyTemplateEntries(projectDir, AUTH_FILES, { goModule: config.goModule });

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

  patchConfigForAuth(path.join(projectDir, "internal", "shared", "config", "config.go"));
  patchMainGoForAuth(path.join(projectDir, "cmd", "api", "main.go"), config.goModule);
  patchEnvExample(path.join(projectDir, ".env.example"));
  patchMakefile(path.join(projectDir, "Makefile"));

  gofmtTree(projectDir);

  writeConfig(projectDir, { ...config, features: { ...config.features, auth: true } });

  console.log(pc.green("\nadded internal/app/user/, internal/shared/middleware/auth.go, and cmd/seed"));
  console.log(
    "registered POST /auth/{register,login,refresh,logout,forgot-password,reset-password}, " +
      "GET /auth/google/{login,callback}, and GET /users/me in cmd/api/main.go"
  );
  console.log(
    pc.dim(
      "\nnext: go mod tidy, then apply the new migrations (AUTO_MIGRATE=true picks them up automatically in dev)\n" +
        "seed an admin: SEED_ADMIN_EMAIL=... SEED_ADMIN_PASSWORD=... make seed"
    )
  );
}

function patchMakefile(makefilePath: string): void {
  if (!fs.existsSync(makefilePath)) return;
  let content = fs.readFileSync(makefilePath, "utf8");
  if (content.includes("\nseed:\n")) return; // already added

  content = content.replace(/^\.PHONY: /m, ".PHONY: seed ");

  const target =
    "\n# bootstrap an admin user (idempotent) — SEED_ADMIN_EMAIL/PASSWORD from the\n" +
    "# environment, not .env, so a real secret never sits in a checked-in file.\n" +
    "# --fixtures adds throwaway dev sample users, never use it outside dev.\n" +
    "seed:\n" +
    "\t@[ -f .env ] && export $$(grep -v '^#' .env | sed -E 's/[[:space:]]+#.*$//' | xargs); go run ./cmd/seed $(ARGS)\n";

  content = content.replace(/\nbuild:/, `${target}\nbuild:`);
  fs.writeFileSync(makefilePath, content);
}

function patchEnvExample(envExamplePath: string): void {
  if (!fs.existsSync(envExamplePath)) return;
  let content = fs.readFileSync(envExamplePath, "utf8");
  if (content.includes("JWT_SECRET")) return; // already added

  content =
    content.replace(/\n?$/, "\n") +
    "\n# HS256 signing secret for access tokens — change this before deploying with APP_ENV=production\n" +
    "JWT_SECRET=dev-secret-change-me\n" +
    "JWT_ACCESS_TTL_MIN=15\n" +
    "JWT_REFRESH_TTL_MIN=43200\n" +
    "COOKIE_SECURE=false\n" +
    "\nPASSWORD_RESET_TTL_MIN=30\n" +
    "PASSWORD_RESET_URL=http://localhost:3000/reset-password\n" +
    "\n# leave the Google vars unset to disable Google login (register/login/refresh still work)\n" +
    "GOOGLE_CLIENT_ID=\n" +
    "GOOGLE_CLIENT_SECRET=\n" +
    "GOOGLE_REDIRECT_URL=\n";
  fs.writeFileSync(envExamplePath, content);
}
