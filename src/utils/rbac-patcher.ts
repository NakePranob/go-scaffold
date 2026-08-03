import fs from "fs-extra";
import { insertBeforeMarkerOnce } from "./marker-patch";

const IMPORT_MARKER = "// go-scaffold:imports";
const MODEL_MARKER = "// go-scaffold:models";
const CONFIG_FIELDS_MARKER = "// go-scaffold:config-fields";
const CONFIG_LOAD_MARKER = "// go-scaffold:config-load";

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

// patchUserModelForRbac adds the Role column to model.User — default 'staff'
// at the DB level (via the gorm tag), so every existing user-creation path
// (Register, Google, cmd/seed) gets a sane role without each one needing to
// set it explicitly.
export function patchUserModelForRbac(userModelPath: string): void {
  let content = fs.readFileSync(userModelPath, "utf8");
  const field = `Role string \`json:"role" gorm:"type:varchar(20);not null;default:'staff'"\``;
  content = insertBeforeMarkerOnce(content, "// go-scaffold:user-fields", field, "Role string");
  fs.writeFileSync(userModelPath, content);
}

// patchMiddlewareAuthForRbac adds RoleKey + the Role claim to the shared
// middleware's own accessClaims copy (see auth.go's own comment on why it's
// duplicated, not imported, from the user package's claims type).
export function patchMiddlewareAuthForRbac(middlewareAuthPath: string): void {
  let content = fs.readFileSync(middlewareAuthPath, "utf8");
  content = insertBeforeMarkerOnce(content, "// go-scaffold:middleware-auth-keys", 'const RoleKey = "role"', 'RoleKey = "role"');
  content = insertBeforeMarkerOnce(content, "// go-scaffold:middleware-auth-claims", 'Role string `json:"role,omitempty"`', "Role string");
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
  content = insertBeforeMarkerOnce(content, "// go-scaffold:jwt-claims", 'Role string `json:"role,omitempty"`', "Role string");
  content = insertBeforeMarkerOnce(content, "// go-scaffold:issue-access-token-params", "role string,", "role string,");
  content = insertBeforeMarkerOnce(content, "// go-scaffold:jwt-claims-values", "Role: role,", "Role: role,");
  fs.writeFileSync(jwtGoPath, content);
}

// patchUserServiceForRbac wires a role.Service dependency into user.Service
// (via a consumer-side roleChecker interface, same convention as
// repository/mailer/tokenStore) and adds SetRole, the one place a user's
// role actually changes after creation.
export function patchUserServiceForRbac(serviceGoPath: string): void {
  let content = fs.readFileSync(serviceGoPath, "utf8");

  const roleCheckerInterface = [
    "// roleChecker = what the service needs from the role domain to validate a",
    "// role assignment — declared consumer-side, same convention as repository/mailer.",
    "type roleChecker interface {",
    "\tCodeExists(ctx context.Context, code string) (bool, error)",
    "}",
  ].join("\n");
  content = insertBeforeMarkerOnce(content, "// go-scaffold:user-interfaces", roleCheckerInterface, "type roleChecker interface");

  content = insertBeforeMarkerOnce(content, "// go-scaffold:user-service-fields", "roles roleChecker", "roles roleChecker");
  content = insertBeforeMarkerOnce(content, "// go-scaffold:user-service-params", "roles roleChecker,", "roles roleChecker,");
  content = insertBeforeMarkerOnce(content, "// go-scaffold:user-service-init", "roles: roles,", "roles: roles,");
  content = insertBeforeMarkerOnce(content, "// go-scaffold:issue-access-token-args", "u.Role,", "u.Role,");

  const setRoleMethod = [
    "// SetRole assigns userID a new role — validated against the role catalog",
    "// (not just the DB's FK) so a typo'd code fails with a clear 422 here",
    "// instead of surfacing as an opaque FK-violation, and so AutoMigrate-only",
    "// test schemas (which never create the FK) still reject it correctly.",
    "func (s *Service) SetRole(ctx context.Context, userID uuid.UUID, roleCode string) (*model.User, error) {",
    "\tu, err := s.repo.FindByID(ctx, userID)",
    "\tif err != nil {",
    "\t\tif errors.Is(err, gorm.ErrRecordNotFound) {",
    "\t\t\treturn nil, errNotFound()",
    "\t\t}",
    "\t\treturn nil, apperror.NewInternal()",
    "\t}",
    "\texists, err := s.roles.CodeExists(ctx, roleCode)",
    "\tif err != nil {",
    "\t\treturn nil, apperror.NewInternal()",
    "\t}",
    "\tif !exists {",
    "\t\treturn nil, errUnknownRole()",
    "\t}",
    "\tu.Role = roleCode",
    "\tif err := s.repo.UpdateUser(ctx, u); err != nil {",
    "\t\treturn nil, apperror.NewInternal()",
    "\t}",
    "\treturn u, nil",
    "}",
  ].join("\n");
  content = insertBeforeMarkerOnce(content, "// go-scaffold:user-service-methods", setRoleMethod, "func (s *Service) SetRole(");

  fs.writeFileSync(serviceGoPath, content);
}

// patchUserDTOForRbac adds the request DTO for PATCH /users/:id/set-role and
// surfaces Role on the /me response — both gated behind RBAC since
// model.User has no Role field at all without it.
export function patchUserDTOForRbac(dtoGoPath: string): void {
  let content = fs.readFileSync(dtoGoPath, "utf8");
  content = insertBeforeMarkerOnce(content, "// go-scaffold:user-me-fields", 'Role string `json:"role"`', "Role string");
  content = insertBeforeMarkerOnce(content, "// go-scaffold:user-me-values", "Role: u.Role,", "Role: u.Role,");
  const setRoleInput = ["type setRoleInput struct {", '\tRole string `json:"role" binding:"required"`', "}"].join("\n");
  content = insertBeforeMarkerOnce(content, "// go-scaffold:user-dto", setRoleInput, "type setRoleInput struct");
  fs.writeFileSync(dtoGoPath, content);
}

// patchUserHandlerForRbac wires an *middleware.Authz into Handler and adds
// the admin routes this PR ships: listing/viewing other users (PermUserRead)
// and changing a user's role (PermUserManageRole). Suspending a user is a
// separate concern, not RBAC's — see the role domain's own /roles,
// /permissions for the actual role/permission management API.
export function patchUserHandlerForRbac(handlerGoPath: string, goModule: string): void {
  let content = fs.readFileSync(handlerGoPath, "utf8");

  content = insertBeforeMarkerOnce(content, "// go-scaffold:user-handler-consts", 'const PermUserManageRole = "user:manage-role"', "PermUserManageRole");
  content = insertBeforeMarkerOnce(content, "// go-scaffold:user-handler-consts", 'const PermUserRead = "user:read"', "PermUserRead");

  const paginationImport = `"${goModule}/internal/shared/pagination"`;
  content = insertBeforeMarkerOnce(content, "// go-scaffold:user-handler-imports", paginationImport, "internal/shared/pagination");

  content = insertBeforeMarkerOnce(content, "// go-scaffold:user-handler-fields", "authz *middleware.Authz", "authz *middleware.Authz");
  content = insertBeforeMarkerOnce(content, "// go-scaffold:user-handler-params", "authz *middleware.Authz,", "authz *middleware.Authz,");
  content = insertBeforeMarkerOnce(content, "// go-scaffold:user-handler-init", "authz: authz,", "authz: authz,");

  content = insertBeforeMarkerOnce(
    content,
    "// go-scaffold:user-routes",
    'usersGroup.GET("", h.authz.Require(PermUserRead), h.adminListUsers)',
    'usersGroup.GET("", h.authz.Require(PermUserRead)'
  );
  content = insertBeforeMarkerOnce(
    content,
    "// go-scaffold:user-routes",
    'usersGroup.GET("/:id", h.authz.Require(PermUserRead), h.adminGetUser)',
    'usersGroup.GET("/:id", h.authz.Require(PermUserRead)'
  );
  content = insertBeforeMarkerOnce(
    content,
    "// go-scaffold:user-routes",
    'usersGroup.PATCH("/:id/set-role", h.authz.Require(PermUserManageRole), h.setRole)',
    'usersGroup.PATCH("/:id/set-role"'
  );

  const adminListHandler = [
    "func (h *Handler) adminListUsers(c *gin.Context) {",
    "\tp := pagination.Parse(c)",
    "\titems, err := h.svc.List(c.Request.Context(), p.Limit, p.Offset)",
    "\tif err != nil {",
    "\t\tc.Error(err)",
    "\t\treturn",
    "\t}",
    "\tout := make([]meResponse, len(items))",
    "\tfor i := range items {",
    "\t\tout[i] = toMeResponse(&items[i])",
    "\t}",
    "\tc.JSON(http.StatusOK, p.Response(out))",
    "}",
  ].join("\n");
  content = insertBeforeMarkerOnce(content, "// go-scaffold:user-handler-funcs", adminListHandler, "func (h *Handler) adminListUsers(");

  const adminGetHandler = [
    "func (h *Handler) adminGetUser(c *gin.Context) {",
    "\tid, ok := httpx.ParseID(c)",
    "\tif !ok {",
    "\t\treturn",
    "\t}",
    "\tu, err := h.svc.Get(c.Request.Context(), id)",
    "\tif err != nil {",
    "\t\tc.Error(err)",
    "\t\treturn",
    "\t}",
    "\tc.JSON(http.StatusOK, toMeResponse(u))",
    "}",
  ].join("\n");
  content = insertBeforeMarkerOnce(content, "// go-scaffold:user-handler-funcs", adminGetHandler, "func (h *Handler) adminGetUser(");

  const setRoleHandler = [
    "func (h *Handler) setRole(c *gin.Context) {",
    "\tid, ok := httpx.ParseID(c)",
    "\tif !ok {",
    "\t\treturn",
    "\t}",
    "\tvar in setRoleInput",
    "\tif err := c.ShouldBindJSON(&in); err != nil {",
    "\t\tc.Error(httpx.BindErr(err))",
    "\t\treturn",
    "\t}",
    "\tu, err := h.svc.SetRole(c.Request.Context(), id, in.Role)",
    "\tif err != nil {",
    "\t\tc.Error(err)",
    "\t\treturn",
    "\t}",
    "\tc.JSON(http.StatusOK, toMeResponse(u))",
    "}",
  ].join("\n");
  content = insertBeforeMarkerOnce(content, "// go-scaffold:user-handler-funcs", setRoleHandler, "func (h *Handler) setRole(");

  fs.writeFileSync(handlerGoPath, content);
}

export function patchUserErrorsForRbac(errorsGoPath: string): void {
  let content = fs.readFileSync(errorsGoPath, "utf8");
  const errFn = ["func errUnknownRole() *apperror.AppError {", '\treturn apperror.New(http.StatusUnprocessableEntity, "USER_UNKNOWN_ROLE", "unknown role code")', "}"].join("\n");
  content = insertBeforeMarkerOnce(content, "// go-scaffold:user-errors", errFn, "func errUnknownRole(");
  fs.writeFileSync(errorsGoPath, content);
}

// patchMainGoForRbac wires the role domain into cmd/api: its import, its
// three models in the AutoMigrate call, and — the one place a plain insert
// isn't enough — REPLACES the `add auth` PR's user.NewHandler(...) call with
// a version that also builds roleSvc/authz and passes them through, plus
// registers role's own routes right after it.
export function patchMainGoForRbac(mainGoPath: string, goModule: string): void {
  let content = fs.readFileSync(mainGoPath, "utf8");

  const importLine = `"${goModule}/internal/app/role"`;
  content = insertBeforeMarkerOnce(content, IMPORT_MARKER, importLine, importLine);
  const modelImportLine = `rolemodel "${goModule}/internal/app/role/model"`;
  content = insertBeforeMarkerOnce(content, IMPORT_MARKER, modelImportLine, modelImportLine);

  const migrateLines = ["&rolemodel.Role{},", "&rolemodel.Permission{},", "&rolemodel.RolePermission{},"];
  for (const line of migrateLines) {
    content = insertBeforeMarkerOnce(content, MODEL_MARKER, line, line);
  }

  const oldRouteLine =
    "user.NewHandler(user.NewService(user.NewRepository(db), user.NewRedisTokenStore(rdb), mail.NewAsyncClient(q), cfg), cfg.JWTSecret, cfg.JWTRefreshTTL, cfg.CookieSecure, rdb).Register(api)";
  if (content.includes(oldRouteLine)) {
    const newRouteBlock = [
      "roleSvc := role.NewService(role.NewRepository(db))",
      "authz := middleware.NewAuthz(roleSvc.PermissionsOf, cfg.AuthzCacheTTL)",
      "user.NewHandler(user.NewService(user.NewRepository(db), user.NewRedisTokenStore(rdb), mail.NewAsyncClient(q), cfg, roleSvc), cfg.JWTSecret, cfg.JWTRefreshTTL, cfg.CookieSecure, rdb, authz).Register(api)",
      "role.NewHandler(roleSvc, cfg.JWTSecret, authz).Register(api)",
    ].join("\n");
    content = content.replace(oldRouteLine, newRouteBlock);
  }

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

  const roleSvcLine = "roleSvc := role.NewService(role.NewRepository(db))";
  content = insertBeforeMarkerOnce(content, "// go-scaffold:seed-services", roleSvcLine, roleSvcLine);
  content = insertBeforeMarkerOnce(content, "// go-scaffold:seed-user-service-args", "roleSvc,", "roleSvc,");

  const setRoleCall = [
    'if _, err := svc.SetRole(ctx, u.ID, "admin"); err != nil {',
    '\tlogger.Error("promote seed admin to admin role", "error", err)',
    "\tos.Exit(1)",
    "}",
  ].join("\n");
  content = insertBeforeMarkerOnce(content, "// go-scaffold:seed-admin-role", setRoleCall, "promote seed admin to admin role");

  fs.writeFileSync(seedMainGoPath, content);
}
