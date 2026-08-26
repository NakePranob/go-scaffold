import fs from "fs-extra";
import { ensureImport, hasMarker, insertBeforeMarker } from "./marker-patch";
import { toCamelCase, toDbName, toPascalCase } from "./naming";
import { GetMethodMode, MethodNaming, MethodType, ModuleNaming } from "../types";

const DTO_MARKER = "// go-scaffold:dto";
const REPO_INTERFACE_MARKER = "// go-scaffold:repository-interface";
const REPO_IMPL_MARKER = "// go-scaffold:repository-methods";
const SERVICE_MARKER = "// go-scaffold:service-methods";
const SERVICE_INTERFACE_MARKER = "// go-scaffold:service-interface";
const COMMAND_REPO_INTERFACE_MARKER = "// go-scaffold:command-repository-interface";
const QUERY_REPO_INTERFACE_MARKER = "// go-scaffold:query-repository-interface";
const COMMAND_MARKER = "// go-scaffold:command-methods";
const QUERY_MARKER = "// go-scaffold:query-methods";
const COMMAND_INTERFACE_MARKER = "// go-scaffold:command-interface";
const QUERY_INTERFACE_MARKER = "// go-scaffold:query-interface";
const HANDLER_ROUTES_MARKER = "// go-scaffold:handler-routes";
const HANDLER_FUNCS_MARKER = "// go-scaffold:handler-funcs";
const REPOSITORY_STUB_FIELDS_MARKER = "// go-scaffold:repository-stub-fields";
const REPOSITORY_STUB_METHODS_MARKER = "// go-scaffold:repository-stub-methods";
const LEGACY_FAKE_REPO_METHODS_MARKER = "// go-scaffold:fake-repo-methods";
const UNUSED_G_LINE = "\t_ = g\n";

// writeHandler ensures whatever packages the new handler code references are
// imported (a minimal module starts with only "gin" imported) and drops the
// `_ = g` placeholder once a real route makes it unnecessary — a no-op on a
// full module, which already imports everything and never has that line.
function writeHandler(handlerPath: string, content: string, goModule: string, needs: string[]): void {
  for (const pkg of needs) {
    const importPath = pkg.startsWith("net/") ? pkg : `${goModule}/internal/shared/${pkg}`;
    content = ensureImport(content, importPath);
  }
  fs.writeFileSync(handlerPath, content.replace(UNUSED_G_LINE, ""));
}

export interface MethodPatchOptions {
  type: MethodType;
  getMode?: GetMethodMode;
  field?: string;
}

export interface MethodPatchPaths {
  dtoPath: string;
  repositoryPath: string;
  /** Present when the module was generated with --cqrs. */
  commandPath?: string;
  /** Present when the module was generated with --cqrs. */
  queryPath?: string;
  servicePath: string;
  handlerPath: string;
  serviceTestPath: string;
}

function isCqrs(paths: MethodPatchPaths): boolean {
  return Boolean(
    paths.commandPath &&
      paths.queryPath &&
      fs.existsSync(paths.commandPath) &&
      fs.existsSync(paths.queryPath)
  );
}

function cqrsTarget(paths: MethodPatchPaths, type: MethodType): {
  path: string;
  implementationMarker: string;
  interfaceMarker: string;
  callReceiver: "commands" | "queries";
} | null {
  if (!isCqrs(paths)) return null;
  if (type === "get") {
    return {
      path: paths.queryPath!,
      implementationMarker: QUERY_MARKER,
      interfaceMarker: QUERY_INTERFACE_MARKER,
      callReceiver: "queries",
    };
  }
  return {
    path: paths.commandPath!,
    implementationMarker: COMMAND_MARKER,
    interfaceMarker: COMMAND_INTERFACE_MARKER,
    callReceiver: "commands",
  };
}

function insertCqrsImplementation(paths: MethodPatchPaths, type: MethodType, block: string, goModule: string): void {
  const target = cqrsTarget(paths, type);
  if (!target) return;
  let content = fs.readFileSync(target.path, "utf8");
  if (type !== "get") {
    content = ensureImport(content, `${goModule}/internal/shared/apperror`);
  }
  content = insertBeforeMarker(content, target.implementationMarker, block);
  fs.writeFileSync(target.path, content);
}

function insertCqrsFacade(servicePath: string, block: string, goModule: string, modulePath: string): void {
  let service = fs.readFileSync(servicePath, "utf8");
  // Minimal CQRS service.go intentionally has no imports until a method is
  // generated. The compatibility facade still uses the normal feature input,
  // model, and UUID types, so make the first generated method compile too.
  service = ensureImport(service, "context");
  service = ensureImport(service, `${goModule}/internal/app/${modulePath}/model`);
  service = ensureImport(service, "github.com/google/uuid");
  service = insertBeforeMarker(service, SERVICE_MARKER, block);
  fs.writeFileSync(servicePath, service);
}

function assertNotDuplicate(content: string, needle: string, what: string): void {
  if (content.includes(needle)) {
    throw new Error(`${what} already exists — pick a different method name`);
  }
}

function routeCall(type: MethodType): string {
  return { get: "GET", post: "POST", put: "PUT", patch: "PATCH", delete: "DELETE" }[type];
}

// assertMethodAbsent is the same check patchMethod runs, exported so callers
// can reach it before their own pre-flight checks. A name that already exists
// is the cause the caller needs to hear about, so it has to be reported ahead
// of anything downstream of it (the OpenAPI document that name would collide
// with, for one) rather than after.
export function assertMethodAbsent(paths: MethodPatchPaths, method: MethodNaming): void {
  const handlerSig = `func (h *Handler) ${method.handlerName}(`;
  const serviceSig = `func (s *Service) ${method.pascalName}(`;
  assertNotDuplicate(fs.readFileSync(paths.handlerPath, "utf8"), handlerSig, `handler method "${method.handlerName}"`);
  assertNotDuplicate(fs.readFileSync(paths.servicePath, "utf8"), serviceSig, `service method "${method.pascalName}"`);
}

export function patchMethod(
  paths: MethodPatchPaths,
  naming: ModuleNaming,
  method: MethodNaming,
  opts: MethodPatchOptions,
  goModule: string
): void {
  assertMethodAbsent(paths, method);

  if (opts.type === "get" && opts.getMode === "all") {
    patchGetAll(paths, naming, method, goModule);
  } else if (opts.type === "get") {
    if (!opts.field) throw new Error("--field is required for --type get --get-mode one");
    if (opts.field.toLowerCase() === "id") {
      throw new Error('--field cannot be "id" — GET /:id already exists as the default lookup');
    }
    patchGetOne(paths, naming, method, opts.field, goModule);
  } else if (opts.type === "post") {
    patchPost(paths, naming, method, goModule);
  } else if (opts.type === "put" || opts.type === "patch") {
    patchResourceAction(paths, method, opts.type, goModule, naming.pkg);
  } else {
    patchDelete(paths, method, goModule, naming.pkg);
  }
  patchHandlerServiceInterface(paths, naming, method, opts, goModule);
}

function patchHandlerServiceInterface(
  paths: MethodPatchPaths,
  naming: ModuleNaming,
  method: MethodNaming,
  opts: MethodPatchOptions,
  goModule: string
): void {
  let signature: string;
  let needsModel = true;
  let needsUUID = false;

  if (opts.type === "get" && opts.getMode === "all") {
    signature = `${method.pascalName}(context.Context, int, int) ([]model.${naming.pascalName}, error)`;
  } else if (opts.type === "get") {
    signature = `${method.pascalName}(context.Context, string) (*model.${naming.pascalName}, error)`;
  } else if (opts.type === "post") {
    signature = `${method.pascalName}(context.Context, ${method.pascalName}Input) (*model.${naming.pascalName}, error)`;
  } else if (opts.type === "put" || opts.type === "patch") {
    signature = `${method.pascalName}(context.Context, uuid.UUID) error`;
    needsModel = false;
    needsUUID = true;
  } else {
    signature = `${method.pascalName}(context.Context, uuid.UUID) error`;
    needsModel = false;
    needsUUID = true;
  }

  let handler = fs.readFileSync(paths.handlerPath, "utf8");
  if (!hasMarker(handler, SERVICE_INTERFACE_MARKER)) {
    // Projects scaffolded before the narrow service interface stored *Service
    // directly. The concrete type already exposes generated methods, so there
    // is no interface declaration to patch and no migration is required.
    if (handler.includes("svc *Service")) return;
    throw new Error(
      `marker "${SERVICE_INTERFACE_MARKER}" not found and Handler does not use legacy *Service wiring`
    );
  }
  handler = insertBeforeMarker(handler, SERVICE_INTERFACE_MARKER, signature);
  handler = ensureImport(handler, "context");
  if (needsModel) {
    handler = ensureImport(handler, `${goModule}/internal/app/${naming.pkg}/model`);
  }
  if (needsUUID) {
    handler = ensureImport(handler, "github.com/google/uuid");
  }
  fs.writeFileSync(paths.handlerPath, handler);

  const target = cqrsTarget(paths, opts.type);
  if (target) {
    let application = fs.readFileSync(target.path, "utf8");
    application = insertBeforeMarker(application, target.interfaceMarker, signature);
    fs.writeFileSync(target.path, application);
  }
}

function patchGetAll(paths: MethodPatchPaths, naming: ModuleNaming, method: MethodNaming, goModule: string): void {
  let handler = fs.readFileSync(paths.handlerPath, "utf8");
  handler = insertBeforeMarker(handler, HANDLER_ROUTES_MARKER, `g.GET("/${method.pathSegment}", h.${method.handlerName})`);
  handler = insertBeforeMarker(
    handler,
    HANDLER_FUNCS_MARKER,
    [
      `func (h *Handler) ${method.handlerName}(c *gin.Context) {`,
      `\tp := pagination.Parse(c)`,
      `\titems, err := ${isCqrs(paths) ? `h.queries.${method.pascalName}` : `h.svc.${method.pascalName}`}(c.Request.Context(), p.Limit, p.Offset)`,
      `\tif err != nil {`,
      `\t\tc.Error(err)`,
      `\t\treturn`,
      `\t}`,
      `\tout := make([]response, len(items))`,
      `\tfor i := range items {`,
      `\t\tout[i] = toResponse(&items[i])`,
      `\t}`,
      `\tc.JSON(http.StatusOK, p.Response(out))`,
      `}`,
      ``,
    ].join("\n")
  );
  writeHandler(paths.handlerPath, handler, goModule, ["net/http", "pagination"]);

  const queryMethod = [
    `func (h *QueryHandler) ${method.pascalName}(ctx context.Context, limit, offset int) ([]model.${naming.pascalName}, error) {`,
    `\t// TODO: add real filtering for "${method.name}" — currently reuses FindAll`,
    `\titems, err := h.repo.FindAll(ctx, limit, offset)`,
    `\tif err != nil {`,
    `\t\treturn nil, apperror.NewInternal(err)`,
    `\t}`,
    `\treturn items, nil`,
    `}`,
    ``,
  ].join("\n");
  const serviceFacade = [
    `func (s *Service) ${method.pascalName}(ctx context.Context, limit, offset int) ([]model.${naming.pascalName}, error) {`,
    `\treturn s.queries.${method.pascalName}(ctx, limit, offset)`,
    `}`,
    ``,
  ].join("\n");
  if (isCqrs(paths)) {
    insertCqrsImplementation(paths, "get", queryMethod, goModule);
    insertCqrsFacade(paths.servicePath, serviceFacade, goModule, naming.pkg);
  } else {
    let service = fs.readFileSync(paths.servicePath, "utf8");
    service = insertBeforeMarker(
      service,
      SERVICE_MARKER,
      queryMethod.replace("(h *QueryHandler)", "(s *Service)").replace("h.repo", "s.repo")
    );
    fs.writeFileSync(paths.servicePath, service);
  }
}

function patchGetOne(
  paths: MethodPatchPaths,
  naming: ModuleNaming,
  method: MethodNaming,
  rawField: string,
  goModule: string
): void {
  const fieldParam = toCamelCase(rawField);
  const fieldPascal = toPascalCase(rawField);
  const fieldColumn = toDbName(rawField);

  let repo = fs.readFileSync(paths.repositoryPath, "utf8");
  assertNotDuplicate(repo, `FindBy${fieldPascal}(`, `repository method "FindBy${fieldPascal}"`);
  repo = insertBeforeMarker(
    repo,
    REPO_IMPL_MARKER,
    [
      `func (r *Repository) FindBy${fieldPascal}(ctx context.Context, ${fieldParam} string) (*model.${naming.pascalName}, error) {`,
      `\tvar m model.${naming.pascalName}`,
      `\t// TODO: add the "${fieldColumn}" column and an index on it — this query`,
      `\t// compiles against any table and only fails when it runs.`,
      `\t//`,
      `\t// tx.From, like every other method here: a lookup that reached for r.db`,
      `\t// directly would read outside a transaction its caller had opened, and`,
      `\t// so miss that transaction's own uncommitted writes.`,
      `\tif err := tx.From(ctx, r.db).WithContext(ctx).First(&m, "${fieldColumn} = ?", ${fieldParam}).Error; err != nil {`,
      `\t\treturn nil, err`,
      `\t}`,
      `\treturn &m, nil`,
      `}`,
      ``,
    ].join("\n")
  );
  fs.writeFileSync(paths.repositoryPath, repo);

  let service = fs.readFileSync(paths.servicePath, "utf8");
  if (isCqrs(paths)) {
    let query = fs.readFileSync(paths.queryPath!, "utf8");
    query = insertBeforeMarker(
      query,
      QUERY_REPO_INTERFACE_MARKER,
      `FindBy${fieldPascal}(ctx context.Context, ${fieldParam} string) (*model.${naming.pascalName}, error)`
    );
    fs.writeFileSync(paths.queryPath!, query);
  } else {
    service = insertBeforeMarker(
      service,
      REPO_INTERFACE_MARKER,
      `FindBy${fieldPascal}(ctx context.Context, ${fieldParam} string) (*model.${naming.pascalName}, error)`
    );
  }

  // The repository interface just grew, so the test double needs a matching
  // method or focused service tests stop compiling. New projects use a
  // function-backed stub; projects scaffolded before that refactor retain the
  // old fakeRepo marker and error behavior.
  let serviceTest = fs.readFileSync(paths.serviceTestPath, "utf8");
  if (
    hasMarker(serviceTest, REPOSITORY_STUB_FIELDS_MARKER) &&
    hasMarker(serviceTest, REPOSITORY_STUB_METHODS_MARKER)
  ) {
    serviceTest = insertBeforeMarker(
      serviceTest,
      REPOSITORY_STUB_FIELDS_MARKER,
      `findBy${fieldPascal}Fn func(context.Context, string) (*model.${naming.pascalName}, error)`
    );
    serviceTest = insertBeforeMarker(
      serviceTest,
      REPOSITORY_STUB_METHODS_MARKER,
      [
        `//nolint:unused`,
        `func (s *repositoryStub) FindBy${fieldPascal}(ctx context.Context, value string) (*model.${naming.pascalName}, error) {`,
        `\tif s.findBy${fieldPascal}Fn == nil {`,
        `\t\tpanic("unexpected repository.FindBy${fieldPascal} call")`,
        `\t}`,
        `\treturn s.findBy${fieldPascal}Fn(ctx, value)`,
        `}`,
        ``,
      ].join("\n")
    );
  } else if (hasMarker(serviceTest, LEGACY_FAKE_REPO_METHODS_MARKER)) {
    serviceTest = insertBeforeMarker(
      serviceTest,
      LEGACY_FAKE_REPO_METHODS_MARKER,
      [
        `//nolint:unused`,
        `func (f *fakeRepo) FindBy${fieldPascal}(context.Context, string) (*model.${naming.pascalName}, error) {`,
        `\tif f.err != nil {`,
        `\t\treturn nil, f.err`,
        `\t}`,
        `\treturn f.m, nil`,
        `}`,
        ``,
      ].join("\n")
    );
  } else {
    throw new Error(
      `neither current repository stub markers nor legacy "${LEGACY_FAKE_REPO_METHODS_MARKER}" found in ${paths.serviceTestPath}`
    );
  }
  fs.writeFileSync(paths.serviceTestPath, serviceTest);

  const queryMethod = [
    `func (h *QueryHandler) ${method.pascalName}(ctx context.Context, ${fieldParam} string) (*model.${naming.pascalName}, error) {`,
    `\tm, err := h.repo.FindBy${fieldPascal}(ctx, ${fieldParam})`,
    `\tif err != nil {`,
    `\t\treturn nil, wrapFindErr(err)`,
    `\t}`,
    `\treturn m, nil`,
    `}`,
    ``,
  ].join("\n");
  const serviceFacade = [
    `func (s *Service) ${method.pascalName}(ctx context.Context, ${fieldParam} string) (*model.${naming.pascalName}, error) {`,
    `\treturn s.queries.${method.pascalName}(ctx, ${fieldParam})`,
    `}`,
    ``,
  ].join("\n");
  if (isCqrs(paths)) {
    insertCqrsImplementation(paths, "get", queryMethod, goModule);
    insertCqrsFacade(paths.servicePath, serviceFacade, goModule, naming.pkg);
  } else {
    service = insertBeforeMarker(
      service,
      SERVICE_MARKER,
      queryMethod.replace("(h *QueryHandler)", "(s *Service)").replace("h.repo", "s.repo")
    );
    fs.writeFileSync(paths.servicePath, service);
  }

  let handler = fs.readFileSync(paths.handlerPath, "utf8");
  handler = insertBeforeMarker(
    handler,
    HANDLER_ROUTES_MARKER,
    `g.GET("/${fieldColumn}/:${fieldParam}", h.${method.handlerName})`
  );
  handler = insertBeforeMarker(
    handler,
    HANDLER_FUNCS_MARKER,
    [
      `func (h *Handler) ${method.handlerName}(c *gin.Context) {`,
      `\t${fieldParam} := c.Param("${fieldParam}")`,
      `\tm, err := ${isCqrs(paths) ? `h.queries.${method.pascalName}` : `h.svc.${method.pascalName}`}(c.Request.Context(), ${fieldParam})`,
      `\tif err != nil {`,
      `\t\tc.Error(err)`,
      `\t\treturn`,
      `\t}`,
      `\tc.JSON(http.StatusOK, toResponse(m))`,
      `}`,
      ``,
    ].join("\n")
  );
  writeHandler(paths.handlerPath, handler, goModule, ["net/http"]);
}

function patchPost(paths: MethodPatchPaths, naming: ModuleNaming, method: MethodNaming, goModule: string): void {
  const inputName = `${method.pascalName}Input`;

  let dto = fs.readFileSync(paths.dtoPath, "utf8");
  assertNotDuplicate(dto, `type ${inputName} struct`, `DTO "${inputName}"`);
  dto = insertBeforeMarker(dto, DTO_MARKER, [`type ${inputName} struct {`, `\t// TODO: add request fields`, `}`, ``].join("\n"));
  fs.writeFileSync(paths.dtoPath, dto);

  let handler = fs.readFileSync(paths.handlerPath, "utf8");
  handler = insertBeforeMarker(handler, HANDLER_ROUTES_MARKER, `g.POST("/${method.pathSegment}", h.${method.handlerName})`);
  handler = insertBeforeMarker(
    handler,
    HANDLER_FUNCS_MARKER,
    [
      `func (h *Handler) ${method.handlerName}(c *gin.Context) {`,
      `\tvar in ${inputName}`,
      `\tif err := c.ShouldBindJSON(&in); err != nil {`,
      `\t\tc.Error(httpx.BindErr(err))`,
      `\t\treturn`,
      `\t}`,
      `\tm, err := ${isCqrs(paths) ? `h.commands.${method.pascalName}` : `h.svc.${method.pascalName}`}(c.Request.Context(), in)`,
      `\tif err != nil {`,
      `\t\tc.Error(err)`,
      `\t\treturn`,
      `\t}`,
      `\tc.JSON(http.StatusCreated, toResponse(m))`,
      `}`,
      ``,
    ].join("\n")
  );
  writeHandler(paths.handlerPath, handler, goModule, ["net/http", "httpx"]);

  const commandMethod = [
    `func (h *CommandHandler) ${method.pascalName}(ctx context.Context, in ${inputName}) (*model.${naming.pascalName}, error) {`,
    `\t// TODO: implement "${method.name}" — this stub does nothing yet`,
    `\t_ = in`,
    `\treturn nil, apperror.NewInternal()`,
    `}`,
    ``,
  ].join("\n");
  const serviceFacade = [
    `func (s *Service) ${method.pascalName}(ctx context.Context, in ${inputName}) (*model.${naming.pascalName}, error) {`,
    `\treturn s.commands.${method.pascalName}(ctx, in)`,
    `}`,
    ``,
  ].join("\n");
  if (isCqrs(paths)) {
    insertCqrsImplementation(paths, "post", commandMethod, goModule);
    insertCqrsFacade(paths.servicePath, serviceFacade, goModule, naming.pkg);
  } else {
    let service = fs.readFileSync(paths.servicePath, "utf8");
    service = insertBeforeMarker(
      service,
      SERVICE_MARKER,
      commandMethod.replace("(h *CommandHandler)", "(s *Service)").replace("h.repo", "s.repo")
    );
    fs.writeFileSync(paths.servicePath, service);
  }
}

function patchResourceAction(
  paths: MethodPatchPaths,
  method: MethodNaming,
  type: "put" | "patch",
  goModule: string,
  modulePath: string
): void {
  let handler = fs.readFileSync(paths.handlerPath, "utf8");
  handler = insertBeforeMarker(
    handler,
    HANDLER_ROUTES_MARKER,
    `g.${routeCall(type)}("/:id/${method.pathSegment}", h.${method.handlerName})`
  );
  handler = insertBeforeMarker(
    handler,
    HANDLER_FUNCS_MARKER,
    [
      `func (h *Handler) ${method.handlerName}(c *gin.Context) {`,
      `\tid, ok := httpx.ParseID(c)`,
      `\tif !ok {`,
      `\t\treturn`,
      `\t}`,
      `\tif err := ${isCqrs(paths) ? `h.commands.${method.pascalName}` : `h.svc.${method.pascalName}`}(c.Request.Context(), id); err != nil {`,
      `\t\tc.Error(err)`,
      `\t\treturn`,
      `\t}`,
      `\tc.Status(http.StatusNotImplemented)`,
      `}`,
      ``,
    ].join("\n")
  );
  writeHandler(paths.handlerPath, handler, goModule, ["net/http", "httpx"]);

  const commandMethod = [
    `func (h *CommandHandler) ${method.pascalName}(ctx context.Context, id uuid.UUID) error {`,
    `\t_ = ctx`,
    `\t_ = id`,
    `\treturn apperror.NewNotImplemented()`,
    `}`,
    ``,
  ].join("\n");
  const serviceFacade = [
    `func (s *Service) ${method.pascalName}(ctx context.Context, id uuid.UUID) error {`,
    `\treturn s.commands.${method.pascalName}(ctx, id)`,
    `}`,
    ``,
  ].join("\n");
  if (isCqrs(paths)) {
    insertCqrsImplementation(paths, type, commandMethod, goModule);
    insertCqrsFacade(paths.servicePath, serviceFacade, goModule, modulePath);
  } else {
    let service = fs.readFileSync(paths.servicePath, "utf8");
    service = insertBeforeMarker(
      service,
      SERVICE_MARKER,
      commandMethod.replace("(h *CommandHandler)", "(s *Service)")
    );
    fs.writeFileSync(paths.servicePath, service);
  }
}

function patchDelete(paths: MethodPatchPaths, method: MethodNaming, goModule: string, modulePath: string): void {
  let handler = fs.readFileSync(paths.handlerPath, "utf8");
  handler = insertBeforeMarker(
    handler,
    HANDLER_ROUTES_MARKER,
    `g.DELETE("/:id/${method.pathSegment}", h.${method.handlerName})`
  );
  handler = insertBeforeMarker(
    handler,
    HANDLER_FUNCS_MARKER,
    [
      `func (h *Handler) ${method.handlerName}(c *gin.Context) {`,
      `\tid, ok := httpx.ParseID(c)`,
      `\tif !ok {`,
      `\t\treturn`,
      `\t}`,
      `\tif err := ${isCqrs(paths) ? `h.commands.${method.pascalName}` : `h.svc.${method.pascalName}`}(c.Request.Context(), id); err != nil {`,
      `\t\tc.Error(err)`,
      `\t\treturn`,
      `\t}`,
      `\tc.Status(http.StatusNoContent)`,
      `}`,
      ``,
    ].join("\n")
  );
  writeHandler(paths.handlerPath, handler, goModule, ["net/http", "httpx"]);

  const commandMethod = [
    `func (h *CommandHandler) ${method.pascalName}(ctx context.Context, id uuid.UUID) error {`,
    `\t// TODO: implement "${method.name}" — this stub does nothing yet`,
    `\treturn apperror.NewInternal()`,
    `}`,
    ``,
  ].join("\n");
  const serviceFacade = [
    `func (s *Service) ${method.pascalName}(ctx context.Context, id uuid.UUID) error {`,
    `\treturn s.commands.${method.pascalName}(ctx, id)`,
    `}`,
    ``,
  ].join("\n");
  if (isCqrs(paths)) {
    insertCqrsImplementation(paths, "delete", commandMethod, goModule);
    insertCqrsFacade(paths.servicePath, serviceFacade, goModule, modulePath);
  } else {
    let service = fs.readFileSync(paths.servicePath, "utf8");
    service = insertBeforeMarker(
      service,
      SERVICE_MARKER,
      commandMethod.replace("(h *CommandHandler)", "(s *Service)")
    );
    fs.writeFileSync(paths.servicePath, service);
  }
}

export function markersPresent(handlerPath: string, servicePath: string): boolean {
  return markersPresentForPaths({ handlerPath, servicePath });
}

export function markersPresentForPaths(
  paths: Pick<MethodPatchPaths, "handlerPath" | "servicePath"> &
    Partial<Pick<MethodPatchPaths, "commandPath" | "queryPath">>
): boolean {
  const handler = fs.readFileSync(paths.handlerPath, "utf8");
  const service = fs.readFileSync(paths.servicePath, "utf8");
  const baseMarkers =
    hasMarker(handler, HANDLER_ROUTES_MARKER) &&
    hasMarker(handler, HANDLER_FUNCS_MARKER) &&
    (hasMarker(handler, SERVICE_INTERFACE_MARKER) || handler.includes("svc *Service")) &&
    hasMarker(service, SERVICE_MARKER) &&
    hasMarker(service, REPO_INTERFACE_MARKER);

  const hasCommand = Boolean(paths.commandPath && fs.existsSync(paths.commandPath));
  const hasQuery = Boolean(paths.queryPath && fs.existsSync(paths.queryPath));
  if (!hasCommand && !hasQuery) return baseMarkers;
  if (!hasCommand || !hasQuery) return false;

  const commands = fs.readFileSync(paths.commandPath!, "utf8");
  const queries = fs.readFileSync(paths.queryPath!, "utf8");
  return (
    baseMarkers &&
    hasMarker(commands, COMMAND_MARKER) &&
    hasMarker(commands, COMMAND_INTERFACE_MARKER) &&
    hasMarker(commands, COMMAND_REPO_INTERFACE_MARKER) &&
    hasMarker(queries, QUERY_MARKER) &&
    hasMarker(queries, QUERY_INTERFACE_MARKER) &&
    hasMarker(queries, QUERY_REPO_INTERFACE_MARKER)
  );
}
