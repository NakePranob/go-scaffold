import path from "path";
import fs from "fs-extra";
import pc from "picocolors";
import { readConfig, writeConfig } from "../utils/config";
import { applyTemplateEntries, gofmtTree } from "../utils/template-renderer";
import { RBAC_FILES } from "../templates/rbac-manifest";
import { newMigrationVersion } from "../utils/migrations";
import {
  patchConfigForRbac,
  patchUserModelForRbac,
  patchMiddlewareAuthForRbac,
  patchUserJWTForRbac,
  patchUserServiceForRbac,
  patchUserServiceTestForRbac,
  patchUserDTOForRbac,
  patchUserHandlerForRbac,
  patchUserErrorsForRbac,
  patchMainGoForRbac,
  patchCmdSeedForRbac,
  patchAuthDocsForRbac,
} from "../utils/rbac-patcher";
import { patchOpenapiIndexRaw } from "../utils/openapi-patcher";

// URL (relative to the api prefix) -> docs file (relative to docs/) for every
// route `add rbac` registers or adds onto the user handler.
const RBAC_OPENAPI_PATHS: { urlPath: string; file: string }[] = [
  { urlPath: "/roles", file: "./rbac/roles.yaml" },
  { urlPath: "/roles/{code}/permissions", file: "./rbac/role-permissions.yaml" },
  { urlPath: "/roles/{code}", file: "./rbac/role.yaml" },
  { urlPath: "/permissions", file: "./rbac/permissions.yaml" },
  { urlPath: "/users", file: "./rbac/users.yaml" },
  { urlPath: "/users/{id}", file: "./rbac/user.yaml" },
  { urlPath: "/users/{id}/set-role", file: "./rbac/user-set-role.yaml" },
];

// addRbac layers role-based access control on top of `add auth`: a role
// domain (roles/permissions/role_permissions, admin-manageable), an Authz
// middleware with a cached role->permission lookup, a Role claim threaded
// through the JWT, and the admin endpoints that actually need it: listing/
// viewing other users (GET /users, GET /users/:id) and changing a user's
// role (PATCH /users/:id/set-role). Opt-in on top of an opt-in — most
// projects need "is this caller logged in" long before they need "can this
// caller do X".
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

  patchConfigForRbac(path.join(projectDir, "internal", "shared", "config", "config.go"));
  patchUserModelForRbac(path.join(projectDir, "internal", "app", "user", "model", "user.go"));
  patchMiddlewareAuthForRbac(path.join(projectDir, "internal", "shared", "middleware", "auth.go"));
  patchUserJWTForRbac(path.join(projectDir, "internal", "app", "user", "jwt.go"));
  patchUserServiceForRbac(path.join(projectDir, "internal", "app", "user", "service.go"));
  patchUserServiceTestForRbac(path.join(projectDir, "internal", "app", "user", "service_test.go"));
  patchUserDTOForRbac(path.join(projectDir, "internal", "app", "user", "dto.go"));
  patchUserHandlerForRbac(path.join(projectDir, "internal", "app", "user", "handler.go"), config.goModule);
  patchUserErrorsForRbac(path.join(projectDir, "internal", "app", "user", "errors.go"));
  patchMainGoForRbac(path.join(projectDir, "cmd", "api", "main.go"), config.goModule);
  patchCmdSeedForRbac(path.join(projectDir, "cmd", "seed", "main.go"), config.goModule);
  patchEnvExample(path.join(projectDir, ".env.example"));

  let docsMessage = "";
  const openapiPath = path.join(projectDir, "docs", "openapi.yaml");
  if (config.features.openapiDocs && fs.existsSync(openapiPath)) {
    const docsEntries = [
      { template: "add/rbac/docs/schemas.yaml.hbs", output: path.join("docs", "rbac", "schemas.yaml") },
      ...RBAC_OPENAPI_PATHS.map(({ file }) => ({
        template: `add/rbac/docs/${path.basename(file)}.hbs`,
        output: path.join("docs", "rbac", path.basename(file)),
      })),
    ];
    await applyTemplateEntries(projectDir, docsEntries, {});
    patchOpenapiIndexRaw(openapiPath, config.apiPrefix, RBAC_OPENAPI_PATHS);
    patchAuthDocsForRbac(path.join(projectDir, "docs", "auth", "schemas.yaml"));
    docsMessage = "\ndocs: docs/rbac/*.yaml, wired into docs/openapi.yaml";
  }

  gofmtTree(projectDir);

  writeConfig(projectDir, { ...config, features: { ...config.features, rbac: true } });

  console.log(pc.green("\nadded internal/app/role/ and internal/shared/middleware/authz.go"));
  console.log(
    "registered GET /users, GET /users/:id, PATCH /users/:id/set-role, /roles, and /permissions in cmd/api/main.go" + docsMessage
  );
  console.log(
    pc.yellow(
      "\n⚠ AUTO_MIGRATE=true does NOT seed the role/permission data — it only creates the\n" +
        "  tables from the Go structs. The \"staff\"/\"admin\" roles and their permissions live\n" +
        "  in the migration's SQL (INSERT statements), which AutoMigrate never runs. Without\n" +
        "  applying it for real, `make seed` fails with \"unknown role code\" and nobody can be\n" +
        "  granted anything. Apply it before relying on RBAC, even in dev:\n" +
        "    migrate -path migrations -database \"$DB_DSN\" up   (or: make migrate-up)"
    )
  );
  console.log(pc.dim("\nnext: go mod tidy, then SEED_ADMIN_EMAIL=... SEED_ADMIN_PASSWORD=... make seed to get an admin"));
}

function patchEnvExample(envExamplePath: string): void {
  if (!fs.existsSync(envExamplePath)) return;
  let content = fs.readFileSync(envExamplePath, "utf8");
  if (content.includes("AUTHZ_CACHE_TTL_MIN")) return; // already added

  content =
    content.replace(/\n?$/, "\n") +
    "\n# how long a role's permission set is cached before Authz.Require re-checks the DB —\n" +
    "# a permission change takes effect for already-issued tokens within this window\n" +
    "AUTHZ_CACHE_TTL_MIN=1\n";
  fs.writeFileSync(envExamplePath, content);
}
