import fs from "fs-extra";
import { ensureImport, hasMarker, insertBeforeMarker } from "./marker-patch";
import { toCamelCase, toDbName, toPascalCase } from "./naming";
import { GetMethodMode, MethodNaming, MethodType, ModuleNaming } from "../types";

const DTO_MARKER = "// go-scaffold:dto";
const REPOSITORY_INTERFACE_MARKER = "// go-scaffold:repository-interface";
const QUERY_REPOSITORY_INTERFACE_MARKER = "// go-scaffold:query-repository-interface";
const REPOSITORY_METHODS_MARKER = "// go-scaffold:repository-methods";
const SERVICE_MARKER = "// go-scaffold:service-methods";
const SERVICE_INTERFACE_MARKER = "// go-scaffold:service-interface";
const COMMAND_MARKER = "// go-scaffold:command-methods";
const COMMAND_INTERFACE_MARKER = "// go-scaffold:command-interface";
const QUERY_MARKER = "// go-scaffold:query-methods";
const QUERY_INTERFACE_MARKER = "// go-scaffold:query-interface";
const HANDLER_ROUTES_MARKER = "// go-scaffold:handler-routes";
const HANDLER_FUNCS_MARKER = "// go-scaffold:handler-funcs";
const REPOSITORY_STUB_FIELDS_MARKER = "// go-scaffold:repository-stub-fields";
const REPOSITORY_STUB_METHODS_MARKER = "// go-scaffold:repository-stub-methods";

export interface HexagonalMethodPatchPaths {
  dtoPath: string;
  requestDTOPath: string;
  portsPath: string;
  repositoryAdapterPath: string;
  servicePath?: string;
  commandPath?: string;
  queryPath?: string;
  handlerPath: string;
  serviceTestPath: string;
  /** Auth has a richer persistence adapter than generated domain modules. */
  repositoryModelType?: string;
  repositoryToDomain?: string;
  repositoryErrorMapper?: string;
  repositoryStubReceiver?: string;
  handlerErrorMapper?: string;
}

type FileSet = Map<string, string>;

function isCqrs(paths: HexagonalMethodPatchPaths): boolean {
  return Boolean(paths.commandPath && paths.queryPath);
}

function read(files: FileSet, file: string): string {
  const value = files.get(file);
  if (value !== undefined) return value;
  const content = fs.readFileSync(file, "utf8");
  files.set(file, content);
  return content;
}

function write(files: FileSet, file: string, content: string): void {
  files.set(file, content);
}

function addImport(content: string, importPath: string): string {
  return ensureImport(content, importPath);
}

function requestDTOMarker(content: string): string {
  if (hasMarker(content, DTO_MARKER)) return DTO_MARKER;
  if (hasMarker(content, "// go-scaffold:user-dto")) return "// go-scaffold:user-dto";
  throw new Error("inbound HTTP DTO file is missing a go-scaffold DTO marker");
}

function insert(content: string, marker: string, block: string): string {
  return insertBeforeMarker(content, marker, block);
}

function serviceApplicationTarget(paths: HexagonalMethodPatchPaths, type: MethodType): { path: string; marker: string; receiver: string } {
  if (isCqrs(paths)) {
    if (type === "get") return { path: paths.queryPath!, marker: QUERY_MARKER, receiver: "h *QueryHandler" };
    return { path: paths.commandPath!, marker: COMMAND_MARKER, receiver: "h *CommandHandler" };
  }
  if (!paths.servicePath) throw new Error("service module is missing application/service.go");
  return { path: paths.servicePath, marker: SERVICE_MARKER, receiver: "s *Service" };
}

function applicationInterfaceMarker(paths: HexagonalMethodPatchPaths, type: MethodType): { path: string; marker: string } {
  if (isCqrs(paths)) {
    return type === "get"
      ? { path: paths.queryPath!, marker: QUERY_INTERFACE_MARKER }
      : { path: paths.commandPath!, marker: COMMAND_INTERFACE_MARKER };
  }
  return { path: paths.servicePath!, marker: SERVICE_INTERFACE_MARKER };
}

function methodSignature(naming: ModuleNaming, method: MethodNaming, opts: { type: MethodType; getMode?: GetMethodMode; field?: string }): string {
  if (opts.type === "get" && opts.getMode === "all") {
    return `${method.pascalName}(context.Context, int, int) ([]domain.${naming.pascalName}, error)`;
  }
  if (opts.type === "get") {
    return `${method.pascalName}(context.Context, string) (*domain.${naming.pascalName}, error)`;
  }
  if (opts.type === "post") {
    return `${method.pascalName}(context.Context, ${method.pascalName}Input) (*domain.${naming.pascalName}, error)`;
  }
  return `${method.pascalName}(context.Context, uuid.UUID) error`;
}

function applicationMethod(naming: ModuleNaming, method: MethodNaming, opts: { type: MethodType; getMode?: GetMethodMode; field?: string }, receiver: string): string {
  const target = receiver.startsWith("s ") ? "s" : "h";
  if (opts.type === "get" && opts.getMode === "all") {
    return [
      `func (${receiver}) ${method.pascalName}(ctx context.Context, limit, offset int) ([]domain.${naming.pascalName}, error) {`,
      `\treturn ${target}.repo.FindAll(ctx, limit, offset)`,
      `}`,
      "",
    ].join("\n");
  }
  if (opts.type === "get") {
    const field = toCamelCase(opts.field ?? "field");
    const fieldPascal = toPascalCase(opts.field ?? "field");
    return [
      `func (${receiver}) ${method.pascalName}(ctx context.Context, ${field} string) (*domain.${naming.pascalName}, error) {`,
      `\treturn ${target}.repo.FindBy${fieldPascal}(ctx, ${field})`,
      `}`,
      "",
    ].join("\n");
  }
  if (opts.type === "post") {
    return [
      `func (${receiver}) ${method.pascalName}(ctx context.Context, in ${method.pascalName}Input) (*domain.${naming.pascalName}, error) {`,
      `\t_ = ctx`,
      `\t_ = in`,
      `\treturn nil, domain.ErrNotImplemented`,
      `}`,
      "",
    ].join("\n");
  }
  return [
    `func (${receiver}) ${method.pascalName}(ctx context.Context, id uuid.UUID) error {`,
    `\t_ = ctx`,
    `\t_ = id`,
    `\treturn domain.ErrNotImplemented`,
    `}`,
    "",
  ].join("\n");
}

function handlerMethod(
  naming: ModuleNaming,
  method: MethodNaming,
  opts: { type: MethodType; getMode?: GetMethodMode; field?: string },
  cqrs: boolean,
  routeReceiver: string,
  errorMapper: string,
): { route: string; body: string; imports: string[] } {
  const receiver = cqrs ? (opts.type === "get" ? "h.queries" : "h.commands") : "h.svc";
  if (opts.type === "get" && opts.getMode === "all") {
    return {
      route: `${routeReceiver}.GET("/${method.pathSegment}", h.${method.handlerName})`,
      imports: ["net/http", "pagination"],
      body: [
        `func (h *Handler) ${method.handlerName}(c *gin.Context) {`,
        `\tp := pagination.Parse(c)`,
        `\titems, err := ${receiver}.${method.pascalName}(c.Request.Context(), p.Limit, p.Offset)`,
        `\tif err != nil {`,
        `\t\tc.Error(${errorMapper}(err))`,
        `\t\treturn`,
        `\t}`,
        `\tout := make([]response, len(items))`,
        `\tfor i := range items {`,
        `\t\tout[i] = toResponse(application.ToResponse(&items[i]))`,
        `\t}`,
        `\tc.JSON(http.StatusOK, p.Response(out))`,
        `}`,
        "",
      ].join("\n"),
    };
  }
  if (opts.type === "get") {
    const field = toCamelCase(opts.field ?? "field");
    const column = toDbName(opts.field ?? "field");
    return {
      route: `${routeReceiver}.GET("/${column}/:${field}", h.${method.handlerName})`,
      imports: ["net/http"],
      body: [
        `func (h *Handler) ${method.handlerName}(c *gin.Context) {`,
        `\t${field} := c.Param("${field}")`,
        `\tm, err := ${receiver}.${method.pascalName}(c.Request.Context(), ${field})`,
        `\tif err != nil {`,
        `\t\tc.Error(${errorMapper}(err))`,
        `\t\treturn`,
        `\t}`,
        `\tc.JSON(http.StatusOK, toResponse(application.ToResponse(m)))`,
        `}`,
        "",
      ].join("\n"),
    };
  }
  if (opts.type === "post") {
    return {
      route: `${routeReceiver}.POST("/${method.pathSegment}", h.${method.handlerName})`,
      imports: ["net/http", "httpx"],
      body: [
        `func (h *Handler) ${method.handlerName}(c *gin.Context) {`,
        `\tvar in ${method.pascalName}Input`,
        `\tif err := c.ShouldBindJSON(&in); err != nil {`,
        `\t\tc.Error(httpx.BindErr(err))`,
        `\t\treturn`,
        `\t}`,
        `\tm, err := ${receiver}.${method.pascalName}(c.Request.Context(), to${method.pascalName}Input(in))`,
        `\tif err != nil {`,
        `\t\tc.Error(${errorMapper}(err))`,
        `\t\treturn`,
        `\t}`,
      `\tc.JSON(http.StatusCreated, toResponse(application.ToResponse(m)))`,
        `}`,
        "",
      ].join("\n"),
    };
  }
  return {
    route: `${routeReceiver}.${opts.type.toUpperCase()}("/:id/${method.pathSegment}", h.${method.handlerName})`,
    imports: ["net/http", "httpx"],
    body: [
      `func (h *Handler) ${method.handlerName}(c *gin.Context) {`,
      `\tid, ok := httpx.ParseID(c)`,
      `\tif !ok {`,
      `\t\treturn`,
      `\t}`,
      `\tif err := ${receiver}.${method.pascalName}(c.Request.Context(), id); err != nil {`,
      `\t\tc.Error(${errorMapper}(err))`,
      `\t\treturn`,
      `\t}`,
      `\tc.Status(http.StatusNoContent)`,
      `}`,
      "",
    ].join("\n"),
  };
}

function assertNotDuplicate(content: string, needle: string, what: string): void {
  if (content.includes(needle)) throw new Error(`${what} already exists — pick a different method name`);
}

function handlerRouteReceiver(content: string): string {
  // Auth's protected routes use usersGroup; generated CRUD modules use the
  // local g group. Both remain the module's inbound adapter boundary.
  return hasMarker(content, "// go-scaffold:user-routes") ? "usersGroup" : "g";
}

export function hexagonalMarkersPresent(paths: HexagonalMethodPatchPaths): boolean {
  if (!fs.existsSync(paths.dtoPath) || !fs.existsSync(paths.requestDTOPath) || !fs.existsSync(paths.portsPath) || !fs.existsSync(paths.repositoryAdapterPath) || !fs.existsSync(paths.handlerPath) || !fs.existsSync(paths.serviceTestPath)) return false;
  const handler = fs.readFileSync(paths.handlerPath, "utf8");
  if (!hasMarker(handler, HANDLER_ROUTES_MARKER) || !hasMarker(handler, HANDLER_FUNCS_MARKER)) return false;
  const dto = fs.readFileSync(paths.dtoPath, "utf8");
  const requestDTO = fs.readFileSync(paths.requestDTOPath, "utf8");
  const ports = fs.readFileSync(paths.portsPath, "utf8");
  const adapter = fs.readFileSync(paths.repositoryAdapterPath, "utf8");
  if (
    !hasMarker(dto, DTO_MARKER) ||
    (!hasMarker(requestDTO, DTO_MARKER) && !hasMarker(requestDTO, "// go-scaffold:user-dto")) ||
    !hasMarker(adapter, REPOSITORY_METHODS_MARKER)
  ) return false;
  if (isCqrs(paths)) {
    return Boolean(paths.commandPath && paths.queryPath && hasMarker(fs.readFileSync(paths.commandPath, "utf8"), COMMAND_MARKER) && hasMarker(fs.readFileSync(paths.commandPath, "utf8"), COMMAND_INTERFACE_MARKER) && hasMarker(fs.readFileSync(paths.queryPath, "utf8"), QUERY_MARKER) && hasMarker(fs.readFileSync(paths.queryPath, "utf8"), QUERY_INTERFACE_MARKER) && hasMarker(ports, COMMAND_REPOSITORY_INTERFACE_MARKER) && hasMarker(ports, QUERY_REPOSITORY_INTERFACE_MARKER));
  }
  return Boolean(paths.servicePath && hasMarker(fs.readFileSync(paths.servicePath, "utf8"), SERVICE_MARKER) && hasMarker(fs.readFileSync(paths.servicePath, "utf8"), SERVICE_INTERFACE_MARKER) && hasMarker(ports, REPOSITORY_INTERFACE_MARKER));
}

const COMMAND_REPOSITORY_INTERFACE_MARKER = "// go-scaffold:command-repository-interface";

export function assertHexagonalMethodAbsent(paths: HexagonalMethodPatchPaths, method: MethodNaming): void {
  assertNotDuplicate(fs.readFileSync(paths.handlerPath, "utf8"), `func (h *Handler) ${method.handlerName}(`, `handler method "${method.handlerName}"`);
  const appFiles = [paths.servicePath, paths.commandPath, paths.queryPath].filter((file): file is string => Boolean(file));
  for (const file of appFiles) assertNotDuplicate(fs.readFileSync(file, "utf8"), `) ${method.pascalName}(`, `application method "${method.pascalName}"`);
}

export function patchHexagonalMethod(
  paths: HexagonalMethodPatchPaths,
  naming: ModuleNaming,
  method: MethodNaming,
  opts: { type: MethodType; getMode?: GetMethodMode; field?: string },
  goModule: string,
): void {
  assertHexagonalMethodAbsent(paths, method);
  if (opts.type === "get" && opts.getMode !== "all" && !opts.field) throw new Error("--field is required for --type get --get-mode one");
  if (opts.type === "get" && opts.field?.toLowerCase() === "id") throw new Error('--field cannot be "id" — GET /:id already exists as the default lookup');

  const files: FileSet = new Map();
  const cqrs = isCqrs(paths);
  const interfaceTarget = applicationInterfaceMarker(paths, opts.type);
  let interfaceFile = read(files, interfaceTarget.path);
  interfaceFile = insert(interfaceFile, interfaceTarget.marker, methodSignature(naming, method, opts));
  write(files, interfaceTarget.path, interfaceFile);

  const target = serviceApplicationTarget(paths, opts.type);
  let applicationFile = read(files, target.path);
  applicationFile = addImport(applicationFile, "context");
  if (opts.type !== "get" && opts.type !== "post") applicationFile = addImport(applicationFile, "github.com/google/uuid");
  applicationFile = insert(applicationFile, target.marker, applicationMethod(naming, method, opts, target.receiver));
  write(files, target.path, applicationFile);

  let handler = read(files, paths.handlerPath);
  const handlerResult = handlerMethod(
    naming,
    method,
    opts,
    cqrs,
    handlerRouteReceiver(handler),
    paths.handlerErrorMapper ?? "appError",
  );
  handler = insert(handler, HANDLER_ROUTES_MARKER, handlerResult.route);
  handler = insert(handler, HANDLER_FUNCS_MARKER, handlerResult.body);
  for (const need of handlerResult.imports) handler = addImport(handler, need.startsWith("net/") ? need : `${goModule}/internal/shared/${need}`);
  write(files, paths.handlerPath, handler);

  if (opts.type === "post") {
    let dto = read(files, paths.dtoPath);
    const inputName = `${method.pascalName}Input`;
    assertNotDuplicate(dto, `type ${inputName} struct`, `DTO "${inputName}"`);
    dto = insert(dto, DTO_MARKER, [`type ${inputName} struct {`, `\t// TODO: add request fields`, `}`, ""].join("\n"));
    write(files, paths.dtoPath, dto);

    let requestDTO = read(files, paths.requestDTOPath);
    assertNotDuplicate(requestDTO, `type ${inputName} struct`, `HTTP DTO "${inputName}"`);
    requestDTO = addImport(requestDTO, `${goModule}/internal/app/${naming.pkg}/application`);
    requestDTO = insert(requestDTO, requestDTOMarker(requestDTO), [
      `type ${inputName} struct {`,
      `\t// TODO: mirror request fields from application.${inputName} and add JSON/binding tags`,
      `}`,
      "",
      `func to${inputName}(in ${inputName}) application.${inputName} {`,
      `\t// TODO: map request fields explicitly into the application input.`,
      `\t_ = in`,
      `\treturn application.${inputName}{}`,
      `}`,
      "",
    ].join("\n"));
    write(files, paths.requestDTOPath, requestDTO);
  }

  if (opts.type === "get" && opts.getMode !== "all") {
    const fieldPascal = toPascalCase(opts.field!);
    const fieldParam = toCamelCase(opts.field!);
    const repoInterfaceMarker = cqrs ? QUERY_REPOSITORY_INTERFACE_MARKER : REPOSITORY_INTERFACE_MARKER;
    let ports = read(files, paths.portsPath);
    ports = insert(ports, repoInterfaceMarker, `FindBy${fieldPascal}(context.Context, string) (*domain.${naming.pascalName}, error)`);
    write(files, paths.portsPath, ports);

    let adapter = read(files, paths.repositoryAdapterPath);
    const column = toDbName(opts.field!);
    const modelType = paths.repositoryModelType ?? `${naming.pascalName}Model`;
    const toDomain = paths.repositoryToDomain ?? "toDomain";
    const errorMapper = paths.repositoryErrorMapper ?? "mapDatabaseError";
    adapter = insert(adapter, REPOSITORY_METHODS_MARKER, [
      `func (r *Repository) FindBy${fieldPascal}(ctx context.Context, ${fieldParam} string) (*domain.${naming.pascalName}, error) {`,
      `\tvar row ${modelType}`,
      `\tif err := tx.From(ctx, r.db).WithContext(ctx).First(&row, "${column} = ?", ${fieldParam}).Error; err != nil {`,
      `\t\treturn nil, ${errorMapper}(err)`,
      `\t}`,
      `\treturn ${toDomain}(&row), nil`,
      `}`,
      "",
    ].join("\n"));
    write(files, paths.repositoryAdapterPath, adapter);

    let test = read(files, paths.serviceTestPath);
    const stubField = `findBy${fieldPascal}Fn`;
    assertNotDuplicate(test, `${stubField} func(`, `repository stub field "${stubField}"`);
    test = insert(test, REPOSITORY_STUB_FIELDS_MARKER, `\t${stubField} func(context.Context, string) (*domain.${naming.pascalName}, error)`);
    const stubReceiver = paths.repositoryStubReceiver ?? "s *repositoryStub";
    const stubVariable = stubReceiver.split(" ")[0];
    assertNotDuplicate(test, `func (${stubReceiver}) FindBy${fieldPascal}(`, `repository stub method "FindBy${fieldPascal}"`);
    test = insert(test, REPOSITORY_STUB_METHODS_MARKER, [
      `func (${stubReceiver}) FindBy${fieldPascal}(ctx context.Context, value string) (*domain.${naming.pascalName}, error) {`,
      `\tif ${stubVariable}.${stubField} == nil {`,
      `\t\tpanic("unexpected repository.FindBy${fieldPascal} call")`,
      `\t}`,
      `\treturn ${stubVariable}.${stubField}(ctx, value)`,
      `}`,
      "",
    ].join("\n"));
    write(files, paths.serviceTestPath, test);
  }

  for (const [file, content] of files) fs.writeFileSync(file, content);
}
