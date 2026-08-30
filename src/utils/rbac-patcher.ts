import { AuthStore } from "../types";
import fs from "fs-extra";
import { authHandlerLineFor } from "./auth-patcher";
import { insertBeforeMarker, insertBeforeMarkerOnce } from "./marker-patch";

const IMPORT_MARKER = "// go-scaffold:imports";
const SCHEMA_MARKER = "// go-scaffold:schemas";
const MODEL_MARKER = "// go-scaffold:models";
const CONFIG_FIELDS_MARKER = "// go-scaffold:config-fields";
const CONFIG_LOAD_MARKER = "// go-scaffold:config-load";

// patchAuthDocsForRbac adds `role` to the hand-written MeResponse schema in
// docs/auth/schemas.yaml — same marker convention as the Go dto.go patch
// (patchUserDTOForRbac), since GET/PATCH /users(/me) all serialize the same
// user response whether or not RBAC is installed.
export function patchAuthDocsForRbac(authSchemasYamlPath: string): void {
  if (!fs.existsSync(authSchemasYamlPath)) return; // openapi docs feature disabled
  let content = fs.readFileSync(authSchemasYamlPath, "utf8");
  content = insertBeforeMarkerOnce(content, "# go-scaffold:me-response-fields", "role: { type: string }", "role: { type: string }");
  fs.writeFileSync(authSchemasYamlPath, content);
}

// patchConfigForRbac adds the Authz permission-cache TTL — configurable
// instead of the hardcoded 1 minute it started as, same marker-based
// insertion patchConfigForAuth uses.
export function patchConfigForRbac(configGoPath: string): void {
  let content = fs.readFileSync(configGoPath, "utf8");
  content = insertBeforeMarkerOnce(content, CONFIG_FIELDS_MARKER, "AuthzCacheTTL time.Duration", "AuthzCacheTTL time.Duration");
  content = insertBeforeMarkerOnce(
    content,
    CONFIG_LOAD_MARKER,
    'AuthzCacheTTL: time.Duration(envInt("AUTHZ_CACHE_TTL_MIN", 1)) * time.Minute,',
    "AuthzCacheTTL: time.Duration"
  );
  fs.writeFileSync(configGoPath, content);
}

// patchUserModelForRbac verifies the auth template exposes the optional role
// field in its outbound persistence model. Auth owns the stable user shape;
// RBAC adds the role catalog and authorization policy on top of it. Keeping
// this check idempotent lets the command work across scaffold versions
// without recreating a second model package.
export function patchUserModelForRbac(userModelPath: string): void {
  let content = fs.readFileSync(userModelPath, "utf8");
  if (/\bRole\s+string\b/.test(content)) return;
  throw new Error(
    `${userModelPath} does not expose User.Role — the auth module must be regenerated or migrated before adding RBAC`
  );
}

// patchMiddlewareAuthForRbac adds RoleKey + the Role claim to the shared
// middleware's own accessClaims copy (see auth.go's own comment on why it's
// duplicated, not imported, from the user package's claims type).
export function patchMiddlewareAuthForRbac(middlewareAuthPath: string): void {
  let content = fs.readFileSync(middlewareAuthPath, "utf8");
  content = insertBeforeMarkerOnce(content, "// go-scaffold:middleware-auth-keys", 'const RoleKey = "role"', 'RoleKey = "role"');
  content = insertGoLineBeforeMarkerOnce(
    content,
    "// go-scaffold:middleware-auth-claims",
    'Role string `json:"role,omitempty"`',
    /^\s*Role\s+string\s+`json:"role,omitempty"`/m
  );
  content = insertBeforeMarkerOnce(content, "// go-scaffold:middleware-auth-context", "c.Set(RoleKey, claims.Role)", "c.Set(RoleKey");
  fs.writeFileSync(middlewareAuthPath, content);
}

// patchUserJWTForRbac adds the Role claim to the access token: the claim
// itself (accessClaims.Role), an extra issueAccessToken param, and the value
// wired into the claims literal — three separate marker points because the
// param list and the struct literal are formatted one-arg-per-line
// specifically so a marker patch can extend either without reformatting.
export function patchUserJWTForRbac(jwtGoPath: string): void {
  let content = fs.readFileSync(jwtGoPath, "utf8");
  content = insertGoLineBeforeMarkerOnce(
    content,
    "// go-scaffold:jwt-claims",
    'Role string `json:"role,omitempty"`',
    /^\s*Role\s+string\s+`json:"role,omitempty"`/m
  );
  content = insertGoLineBeforeMarkerOnce(
    content,
    "// go-scaffold:issue-access-token-params",
    "role string,",
    /^\s*role\s+string\s*,/m
  );
  content = insertGoLineBeforeMarkerOnce(
    content,
    "// go-scaffold:jwt-claims-values",
    "Role: role,",
    /^\s*Role\s*:\s*role\s*,/m
  );
  fs.writeFileSync(jwtGoPath, content);
}

// Go fmt aligns struct fields and can turn a literal sentinel such as
// `Role string` into `Role       string`. Match the Go line semantically so a
// subsequent `add rbac` cannot append a duplicate field after formatting.
function insertGoLineBeforeMarkerOnce(content: string, marker: string, block: string, line: RegExp): string {
  if (line.test(content)) return content;
  return insertBeforeMarker(content, marker, block);
}

// patchUserServiceForRbac verifies the auth application already exposes the
// optional role capability. The canonical auth template owns this shared user
// behavior; `add rbac` only supplies the role catalog and authorizer.
export function patchUserServiceForRbac(serviceGoPath: string, sessionsGoPath?: string): void {
  const content = fs.readFileSync(serviceGoPath, "utf8");
  for (const required of ["roles             ports.RoleChecker", "func (s *Service) SetRole(", "// go-scaffold:service-interface"]) {
    if (!content.includes(required)) {
      throw new Error(`${serviceGoPath} is missing the canonical auth role capability (${required}); regenerate auth before adding RBAC`);
    }
  }
  if (sessionsGoPath && fs.existsSync(sessionsGoPath)) {
    const sessions = fs.readFileSync(sessionsGoPath, "utf8");
    if (!sessions.includes("u.Role,")) {
      throw new Error(`${sessionsGoPath} does not include the user's role in access-token issuance; regenerate auth before adding RBAC`);
    }
  }
}

// patchUserServiceTestForRbac verifies the canonical auth test seam already
// supplies the optional role capability. It is part of the auth contract so
// adding RBAC does not rewrite every test call site.
export function patchUserServiceTestForRbac(serviceTestGoPath: string): void {
  const content = fs.readFileSync(serviceTestGoPath, "utf8");
  for (const required of ["type fakeRoles struct{}", "Roles:             fakeRoles{},", "// go-scaffold:user-service-test-deps"]) {
    if (!content.includes(required)) {
      throw new Error(`${serviceTestGoPath} is missing the canonical auth role test seam (${required}); regenerate auth before adding RBAC`);
    }
  }
}

// patchUserDTOForRbac verifies the role DTOs owned by the canonical auth
// inbound adapter. The routes remain inactive until an Authz is composed.
export function patchUserDTOForRbac(dtoGoPath: string): void {
  const content = fs.readFileSync(dtoGoPath, "utf8");
  if (!/\bRole\s+string\s+`json:"role"`/.test(content)) {
    throw new Error(`${dtoGoPath} is missing the canonical auth role DTO; regenerate auth before adding RBAC`);
  }
  if (!/Role:\s+user\.Role,/.test(content)) {
    throw new Error(`${dtoGoPath} is missing the canonical auth role DTO mapping; regenerate auth before adding RBAC`);
  }
  if (!content.includes("type setRoleInput struct")) {
    throw new Error(`${dtoGoPath} is missing the canonical auth role DTO (type setRoleInput struct); regenerate auth before adding RBAC`);
  }
}

// patchUserHandlerForRbac verifies that auth owns the role-aware admin route
// surface. The routes are guarded by the optional authorizer, so adding RBAC
// composes the guard; it does not copy or rewrite handler code.
export function patchUserHandlerForRbac(handlerGoPath: string): void {
  const content = fs.readFileSync(handlerGoPath, "utf8");
  for (const required of [
    "authz   authorizer",
    "func (h *Handler) adminListUsers(",
    "func (h *Handler) adminGetUser(",
    "func (h *Handler) setRole(",
    'usersGroup.GET("", h.authz.Require(PermUserRead), h.adminListUsers)',
    'usersGroup.GET("/:id", h.authz.Require(PermUserRead), h.adminGetUser)',
    'usersGroup.PATCH("/:id/set-role", h.authz.Require(PermUserManageRole), h.setRole)',
  ]) {
    if (!content.includes(required)) {
      throw new Error(`${handlerGoPath} is missing the canonical auth role route (${required}); regenerate auth before adding RBAC`);
    }
  }
}

export function patchUserErrorsForRbac(errorsGoPath: string): void {
  const content = fs.readFileSync(errorsGoPath, "utf8");
  if (!content.includes("func errUnknownRole(")) {
    throw new Error(`${errorsGoPath} is missing the canonical unknown-role error; regenerate auth before adding RBAC`);
  }
}

export function assertRbacPatchable(mainGoPath: string, goModule: string, store: AuthStore, worker: boolean): void {
  const wiring = { goModule, queueBackend: "river" as const, store, worker };
  const content = fs.readFileSync(mainGoPath, "utf8");
  const expected = authHandlerLineFor(wiring);
  if (content.includes(expected)) return;
  throw new Error(
    "cmd/api/wiring.go's auth route doesn't match what `add auth` wrote, so `add rbac` can't extend it.\n" +
      `Expected to find:\n  ${expected}\n\n` +
      "It was probably hand-edited. Restore that route and re-run — nothing has been changed yet."
  );
}

export function patchMainGoForRbac(mainGoPath: string, goModule: string, store: AuthStore, worker: boolean): void {
  let content = fs.readFileSync(mainGoPath, "utf8");

  const importLine = `"${goModule}/internal/app/role"`;
  content = insertBeforeMarkerOnce(content, IMPORT_MARKER, importLine, importLine);
  const modelImportLine = `rolepostgres "${goModule}/internal/app/role/adapters/outbound/postgres"`;
  content = insertBeforeMarkerOnce(content, IMPORT_MARKER, modelImportLine, modelImportLine);

  const schemaBlock = [
    'if err := db.Exec("CREATE SCHEMA IF NOT EXISTS role_svc").Error; err != nil {',
    '\treturn fmt.Errorf("create schema role_svc: %w", err)',
    "}",
  ].join("\n");
  content = insertBeforeMarkerOnce(content, SCHEMA_MARKER, schemaBlock, "CREATE SCHEMA IF NOT EXISTS role_svc");

  const migrateLines = ["&rolepostgres.Role{},", "&rolepostgres.Permission{},", "&rolepostgres.RolePermission{},"];
  for (const line of migrateLines) {
    content = insertBeforeMarkerOnce(content, MODEL_MARKER, line, line);
  }

  const wiring = { goModule, queueBackend: "river" as const, store, worker };
  const authRouteLine = authHandlerLineFor(wiring);
  const roleCompositionLine = "roleComposition := role.NewCompositionFromDB(db, cfg.JWTSecret, cfg.AuthzCacheTTL)";
  const roleHandlerLine = "roleComposition.Handler.Register(api)";

  if (!content.includes(authRouteLine)) {
    throw new Error(
      `cmd/api/wiring.go's auth route doesn't match what \`add auth\` wrote, so \`add rbac\` can't extend it.\n` +
        `Expected to find:\n  ${authRouteLine}\n\n` +
        "It was probably hand-edited. Restore that route and re-run — nothing has been changed yet."
    );
  }
  const authWithRoleLine = authHandlerLineFor(wiring, ["roleComposition.Service", "roleComposition.Authz"]);
  content = content.replace(authRouteLine, [roleCompositionLine, authWithRoleLine, roleHandlerLine].join("\n"));

  fs.writeFileSync(mainGoPath, content);
}

// patchCmdSeedForRbac makes the seeded admin actually an admin: wires a
// role.Service into cmd/seed's own user.Service, then calls SetRole right
// after EnsureUser creates/finds the SEED_ADMIN_EMAIL user (fixtures stay on
// the 'staff' DB default — only the operator-specified admin gets promoted).
export function patchCmdSeedForRbac(seedMainGoPath: string, goModule: string): void {
  let content = fs.readFileSync(seedMainGoPath, "utf8");

  const importLine = `"${goModule}/internal/app/role"`;
  content = insertBeforeMarkerOnce(content, "// go-scaffold:seed-imports", importLine, importLine);

  const roleSvcLine = "roleSvc := role.NewServiceFromDB(db)";
  content = insertBeforeMarkerOnce(content, "// go-scaffold:seed-services", roleSvcLine, roleSvcLine);
  const seedRoleDependency = content.includes("user.Dependencies{") ? "Roles: roleSvc," : "roleSvc,";
  content = insertBeforeMarkerOnce(content, "// go-scaffold:seed-user-service-args", seedRoleDependency, seedRoleDependency);

  const setRoleCall = [
    'if _, err := svc.SetRole(ctx, u.ID, "admin"); err != nil {',
    '\tlogger.Error("promote seed admin to admin role", "error", err)',
    "\tos.Exit(1)",
    "}",
  ].join("\n");
  content = insertBeforeMarkerOnce(content, "// go-scaffold:seed-admin-role", setRoleCall, "promote seed admin to admin role");

  fs.writeFileSync(seedMainGoPath, content);
}
