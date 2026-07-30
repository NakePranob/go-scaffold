import path from "path";
import fs from "fs-extra";
import pc from "picocolors";
import { readConfig, writeConfig } from "../utils/config";
import { applyTemplateEntries, gofmtTree } from "../utils/template-renderer";
import { RBAC_FILES } from "../templates/rbac-manifest";
import { newMigrationVersion } from "../utils/migrations";
import {
  patchUserModelForRbac,
  patchMiddlewareAuthForRbac,
  patchUserJWTForRbac,
  patchUserServiceForRbac,
  patchUserDTOForRbac,
  patchUserHandlerForRbac,
  patchUserErrorsForRbac,
  patchMainGoForRbac,
  patchCmdSeedForRbac,
} from "../utils/rbac-patcher";

// addRbac layers role-based access control on top of `add auth`: a role
// domain (roles/permissions/role_permissions, admin-manageable), an Authz
// middleware with a cached role->permission lookup, a Role claim threaded
// through the JWT, and one admin endpoint (PATCH /users/:id/set-role) that
// actually needs it. Opt-in on top of an opt-in — most projects need "is
// this caller logged in" long before they need "can this caller do X".
export async function addRbac(projectDir: string = process.cwd()): Promise<void> {
  const config = readConfig(projectDir);

  if (!config.features.auth) {
    throw new Error("`go-scaffold add rbac` requires `go-scaffold add auth` first — there's no Role claim to check permissions against otherwise");
  }

  const roleDir = path.join(projectDir, "internal", "app", "role");
  if (fs.existsSync(roleDir)) {
    throw new Error(`${roleDir} already exists — RBAC looks like it's already been added`);
  }

  await applyTemplateEntries(projectDir, RBAC_FILES, { goModule: config.goModule });

  const migrationsDir = path.join(projectDir, "migrations");
  fs.ensureDirSync(migrationsDir);
  const version = newMigrationVersion(migrationsDir);
  await applyTemplateEntries(
    projectDir,
    [
      { template: "add/rbac/migrations/add_roles.up.sql.hbs", output: path.join("migrations", `${version}_add_roles.up.sql`) },
      { template: "add/rbac/migrations/add_roles.down.sql.hbs", output: path.join("migrations", `${version}_add_roles.down.sql`) },
    ],
    {}
  );

  patchUserModelForRbac(path.join(projectDir, "internal", "app", "user", "model", "user.go"));
  patchMiddlewareAuthForRbac(path.join(projectDir, "internal", "shared", "middleware", "auth.go"));
  patchUserJWTForRbac(path.join(projectDir, "internal", "app", "user", "jwt.go"));
  patchUserServiceForRbac(path.join(projectDir, "internal", "app", "user", "service.go"));
  patchUserDTOForRbac(path.join(projectDir, "internal", "app", "user", "dto.go"));
  patchUserHandlerForRbac(path.join(projectDir, "internal", "app", "user", "handler.go"));
  patchUserErrorsForRbac(path.join(projectDir, "internal", "app", "user", "errors.go"));
  patchMainGoForRbac(path.join(projectDir, "cmd", "api", "main.go"), config.goModule);
  patchCmdSeedForRbac(path.join(projectDir, "cmd", "seed", "main.go"), config.goModule);

  gofmtTree(projectDir);

  writeConfig(projectDir, { ...config, features: { ...config.features, rbac: true } });

  console.log(pc.green("\nadded internal/app/role/ and internal/shared/middleware/authz.go"));
  console.log("registered PATCH /users/:id/set-role, /roles, and /permissions in cmd/api/main.go");
  console.log(pc.dim("\nnext: go mod tidy, apply the new migration, then SEED_ADMIN_EMAIL=... make seed to get an admin"));
}
