import fs from "fs-extra";
import { ensureImport, hasMarker, insertBeforeMarker } from "./marker-patch";
import { toCamelCase, toDbName, toPascalCase } from "./naming";
import { GetMethodMode, MethodNaming, MethodType, ModuleNaming } from "../types";

const DTO_MARKER = "// go-scaffold:dto";
const REPO_INTERFACE_MARKER = "// go-scaffold:repository-interface";
const REPO_IMPL_MARKER = "// go-scaffold:repository-methods";
const SERVICE_MARKER = "// go-scaffold:service-methods";
const HANDLER_ROUTES_MARKER = "// go-scaffold:handler-routes";
const HANDLER_FUNCS_MARKER = "// go-scaffold:handler-funcs";
const FAKE_REPO_MARKER = "// go-scaffold:fake-repo-methods";
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
  servicePath: string;
  handlerPath: string;
  serviceTestPath: string;
}

function assertNotDuplicate(content: string, needle: string, what: string): void {
  if (content.includes(needle)) {
    throw new Error(`${what} already exists — pick a different method name`);
  }
}

function routeCall(type: MethodType): string {
  return { get: "GET", post: "POST", put: "PUT", patch: "PATCH", delete: "DELETE" }[type];
}

export function patchMethod(
  paths: MethodPatchPaths,
  naming: ModuleNaming,
  method: MethodNaming,
  opts: MethodPatchOptions,
  goModule: string
): void {
  const handlerSig = `func (h *Handler) ${method.handlerName}(`;
  const serviceSig = `func (s *Service) ${method.pascalName}(`;

  const handlerContent = fs.readFileSync(paths.handlerPath, "utf8");
  const serviceContent = fs.readFileSync(paths.servicePath, "utf8");
  assertNotDuplicate(handlerContent, handlerSig, `handler method "${method.handlerName}"`);
  assertNotDuplicate(serviceContent, serviceSig, `service method "${method.pascalName}"`);

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
    patchResourceAction(paths, naming, method, opts.type, goModule);
  } else {
    patchDelete(paths, method, goModule);
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
      `\titems, err := h.svc.${method.pascalName}(c.Request.Context(), p.Limit, p.Offset)`,
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

  let service = fs.readFileSync(paths.servicePath, "utf8");
  service = insertBeforeMarker(
    service,
    SERVICE_MARKER,
    [
      `func (s *Service) ${method.pascalName}(ctx context.Context, limit, offset int) ([]model.${naming.pascalName}, error) {`,
      `\t// TODO: add real filtering for "${method.name}" — currently reuses FindAll`,
      `\titems, err := s.repo.FindAll(ctx, limit, offset)`,
      `\tif err != nil {`,
      `\t\treturn nil, apperror.NewInternal()`,
      `\t}`,
      `\treturn items, nil`,
      `}`,
      ``,
    ].join("\n")
  );
  fs.writeFileSync(paths.servicePath, service);
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
      `\t// TODO: confirm "${fieldColumn}" is the real column name for ${fieldParam}`,
      `\tif err := r.db.WithContext(ctx).First(&m, "${fieldColumn} = ?", ${fieldParam}).Error; err != nil {`,
      `\t\treturn nil, err`,
      `\t}`,
      `\treturn &m, nil`,
      `}`,
      ``,
    ].join("\n")
  );
  fs.writeFileSync(paths.repositoryPath, repo);

  let service = fs.readFileSync(paths.servicePath, "utf8");
  service = insertBeforeMarker(
    service,
    REPO_INTERFACE_MARKER,
    `FindBy${fieldPascal}(ctx context.Context, ${fieldParam} string) (*model.${naming.pascalName}, error)`
  );

  // the interface just grew, so the hand-written fakeRepo mock in
  // service_test.go needs a matching stub or the test file stops compiling
  let serviceTest = fs.readFileSync(paths.serviceTestPath, "utf8");
  serviceTest = insertBeforeMarker(
    serviceTest,
    FAKE_REPO_MARKER,
    [
      // nolint: only matters for a minimal module (fakeRepo never instantiated
      // yet, so unused flags every one of its methods individually); harmless
      // no-op on a full module where fakeRepo is already in use.
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
  fs.writeFileSync(paths.serviceTestPath, serviceTest);

  service = insertBeforeMarker(
    service,
    SERVICE_MARKER,
    [
      `func (s *Service) ${method.pascalName}(ctx context.Context, ${fieldParam} string) (*model.${naming.pascalName}, error) {`,
      `\tm, err := s.repo.FindBy${fieldPascal}(ctx, ${fieldParam})`,
      `\tif err != nil {`,
      `\t\treturn nil, wrapFindErr(err)`,
      `\t}`,
      `\treturn m, nil`,
      `}`,
      ``,
    ].join("\n")
  );
  fs.writeFileSync(paths.servicePath, service);

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
      `\tm, err := h.svc.${method.pascalName}(c.Request.Context(), ${fieldParam})`,
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
      `\tm, err := h.svc.${method.pascalName}(c.Request.Context(), in)`,
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

  let service = fs.readFileSync(paths.servicePath, "utf8");
  service = insertBeforeMarker(
    service,
    SERVICE_MARKER,
    [
      `func (s *Service) ${method.pascalName}(ctx context.Context, in ${inputName}) (*model.${naming.pascalName}, error) {`,
      `\t// TODO: implement "${method.name}" — this stub does nothing yet`,
      `\t_ = in`,
      `\treturn nil, apperror.NewInternal()`,
      `}`,
      ``,
    ].join("\n")
  );
  fs.writeFileSync(paths.servicePath, service);
}

function patchResourceAction(
  paths: MethodPatchPaths,
  naming: ModuleNaming,
  method: MethodNaming,
  type: "put" | "patch",
  goModule: string
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
      `\tm, err := h.svc.${method.pascalName}(c.Request.Context(), id)`,
      `\tif err != nil {`,
      `\t\tc.Error(err)`,
      `\t\treturn`,
      `\t}`,
      `\tc.JSON(http.StatusOK, toResponse(m))`,
      `}`,
      ``,
    ].join("\n")
  );
  writeHandler(paths.handlerPath, handler, goModule, ["net/http", "httpx"]);

  let service = fs.readFileSync(paths.servicePath, "utf8");
  service = insertBeforeMarker(
    service,
    SERVICE_MARKER,
    [
      `func (s *Service) ${method.pascalName}(ctx context.Context, id uuid.UUID) (*model.${naming.pascalName}, error) {`,
      `\tm, err := s.repo.FindByID(ctx, id)`,
      `\tif err != nil {`,
      `\t\treturn nil, wrapFindErr(err)`,
      `\t}`,
      `\t// TODO: implement "${method.name}" — currently a no-op save`,
      `\tif err := s.repo.Update(ctx, m); err != nil {`,
      `\t\treturn nil, apperror.NewInternal()`,
      `\t}`,
      `\treturn m, nil`,
      `}`,
      ``,
    ].join("\n")
  );
  fs.writeFileSync(paths.servicePath, service);
}

function patchDelete(paths: MethodPatchPaths, method: MethodNaming, goModule: string): void {
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
      `\tif err := h.svc.${method.pascalName}(c.Request.Context(), id); err != nil {`,
      `\t\tc.Error(err)`,
      `\t\treturn`,
      `\t}`,
      `\tc.Status(http.StatusNoContent)`,
      `}`,
      ``,
    ].join("\n")
  );
  writeHandler(paths.handlerPath, handler, goModule, ["net/http", "httpx"]);

  let service = fs.readFileSync(paths.servicePath, "utf8");
  service = insertBeforeMarker(
    service,
    SERVICE_MARKER,
    [
      `func (s *Service) ${method.pascalName}(ctx context.Context, id uuid.UUID) error {`,
      `\t// TODO: implement "${method.name}" — this stub does nothing yet`,
      `\treturn apperror.NewInternal()`,
      `}`,
      ``,
    ].join("\n")
  );
  fs.writeFileSync(paths.servicePath, service);
}

export function markersPresent(handlerPath: string, servicePath: string): boolean {
  const handler = fs.readFileSync(handlerPath, "utf8");
  const service = fs.readFileSync(servicePath, "utf8");
  return (
    hasMarker(handler, HANDLER_ROUTES_MARKER) &&
    hasMarker(handler, HANDLER_FUNCS_MARKER) &&
    hasMarker(service, SERVICE_MARKER) &&
    hasMarker(service, REPO_INTERFACE_MARKER)
  );
}
