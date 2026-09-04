import path from "path";
import fs from "fs-extra";
import pc from "picocolors";
import { readConfig } from "../utils/config";
import {
  assertGoIdentifier,
  resolveMethodNaming,
  toCamelCase,
  toDbName,
} from "../utils/naming";
import { existingModulePackages, resolveProjectModuleNaming } from "../utils/module-location";
import { assertNoDrift, typeChecks } from "../utils/gocheck";
import { applyTemplateEntries, gofmtTree } from "../utils/template-renderer";
import { newMigrationVersion } from "../utils/migrations";
import { patchOpenapiIndexRaw } from "../utils/openapi-patcher";
import {
  promptGetMode,
  promptLookupField,
  promptMethodName,
  promptMethodType,
  promptExistingModule,
} from "../prompts/generate-wizard";
import { GetMethodMode, MethodType, ModuleNaming, MethodNaming } from "../types";
import {
  HexagonalMethodPatchPaths,
  assertHexagonalMethodAbsent,
  hexagonalMarkersPresent,
  patchHexagonalMethod,
} from "../utils/hexagonal-method-patcher";

// URL path registered in the inbound adapter, excluding the project-wide API
// prefix so it can be passed directly to patchOpenapiIndexRaw.
function methodRoutePath(
  naming: ModuleNaming,
  method: MethodNaming,
  type: MethodType,
  getMode?: GetMethodMode,
  field?: string
): string {
  const base = `/${naming.plural}`;
  if (type === "get" && getMode === "all") return `${base}/${method.pathSegment}`;
  if (type === "get") return `${base}/${toDbName(field ?? "")}/{${toCamelCase(field ?? "")}}`;
  if (type === "post") return `${base}/${method.pathSegment}`;
  return `${base}/{id}/${method.pathSegment}`;
}

function routeHint(
  naming: ModuleNaming,
  method: MethodNaming,
  type: MethodType,
  apiPrefix: string,
  getMode?: GetMethodMode,
  field?: string
): string {
  const path = methodRoutePath(naming, method, type, getMode, field);
  const prefixed = apiPrefix ? `/${apiPrefix}${path}` : path;
  return `${type.toUpperCase()} ${prefixed}`;
}

function methodOpenapiDocument(
  naming: ModuleNaming,
  method: MethodNaming,
  type: MethodType,
  getMode?: GetMethodMode,
  field?: string
): string {
  const pathParameters: string[] = [];
  if (type === "get" && getMode === "one") {
    const parameter = toCamelCase(field ?? "");
    pathParameters.push(
      "parameters:",
      `  - name: ${parameter}`,
      "    in: path",
      "    required: true",
      "    schema:",
      "      type: string"
    );
  } else if (type === "put" || type === "patch" || type === "delete") {
    pathParameters.push(
      "parameters:",
      "  - name: id",
      "    in: path",
      "    required: true",
      "    schema:",
      "      type: string",
      "      format: uuid"
    );
  }

  const operation = [
    `${type}:`,
    `  summary: TODO document ${method.name}`,
    `  operationId: ${method.handlerName}${naming.pascalName}`,
    `  tags: [${naming.plural}]`,
  ];
  if (type === "post") {
    operation.push(
      "  requestBody:",
      "    required: true",
      "    content:",
      "      application/json:",
      "        schema:",
      "          type: object",
      "          description: TODO define request fields"
    );
  }

  const status = type === "delete" ? "204" : type === "post" ? "201" : type === "put" || type === "patch" ? "501" : "200";
  operation.push(
    "  responses:",
    `    \"${status}\":`,
    `      description: ${type === "delete" ? "completed or already absent" : type === "put" || type === "patch" ? "not implemented" : "TODO define response"}`
  );
  if (type !== "delete" && type !== "put" && type !== "patch") {
    operation.push(
      "      content:",
      "        application/json:",
      "          schema:",
      "            type: object",
      "            description: TODO replace with the method response schema"
    );
  }
  operation.push("    \"400\": { $ref: '../../common/responses.yaml#/ValidationError' }");
  if (type === "get") {
    operation.push("    \"404\": { $ref: '../../common/responses.yaml#/NotFoundError' }");
  }

  return [...pathParameters, ...operation, ""].join("\n");
}

export interface GenerateMethodOptions {
  type?: MethodType;
  getMode?: GetMethodMode;
  field?: string;
}

async function generateHexagonalMethod(
  config: ReturnType<typeof readConfig>,
  naming: ModuleNaming,
  methodNameArg: string | undefined,
  opts: GenerateMethodOptions,
  projectDir: string,
): Promise<void> {
  const moduleDir = path.join(projectDir, "internal", "app", naming.pkg);
  const moduleConfig = config.modules[naming.pkg];
  if (!moduleConfig) {
    throw new Error("module " + naming.pkg + " has no split-layout metadata in go-scaffold.config.json; run go-scaffold check first");
  }
  const cqrs = moduleConfig.applicationStyle === "cqrs";
  const authModule = naming.pkg === "user" && fs.existsSync(path.join(moduleDir, "application", "contracts.go"));
  const paths: HexagonalMethodPatchPaths = {
    dtoPath: path.join(moduleDir, "application", "dto.go"),
    requestDTOPath: path.join(moduleDir, "adapters", "inbound", "http", "dto.go"),
    portsPath: path.join(moduleDir, "ports", "repository.go"),
    repositoryAdapterPath: path.join(moduleDir, "adapters", "outbound", "postgres", "repository.go"),
    servicePath: cqrs ? undefined : path.join(moduleDir, "application", "service.go"),
    commandPath: cqrs ? path.join(moduleDir, "application", "commands.go") : undefined,
    queryPath: cqrs ? path.join(moduleDir, "application", "queries.go") : undefined,
    handlerPath: path.join(moduleDir, "adapters", "inbound", "http", "handler.go"),
    serviceTestPath: path.join(moduleDir, "application", moduleConfig.applicationStyle === "cqrs" ? "cqrs_test.go" : "service_test.go"),
    ...(authModule
      ? {
          repositoryModelType: "User",
          repositoryToDomain: "toDomainUser",
          repositoryToDomainCall: "r.toDomainUser(ctx, &row)",
          repositoryToDomainCallReturnsError: true,
          repositoryErrorMapper: "persistenceError",
          repositoryStubReceiver: "f *fakeRepo",
          handlerErrorMapper: "toHTTPError",
        }
      : {}),
  };
  const required = [
    paths.dtoPath,
    paths.requestDTOPath,
    paths.portsPath,
    paths.repositoryAdapterPath,
    paths.handlerPath,
    paths.serviceTestPath,
    ...(cqrs ? [paths.commandPath!, paths.queryPath!] : [paths.servicePath!]),
  ];
  const missing = required.filter((file) => !fs.existsSync(file));
  if (missing.length) {
    throw new Error(
      "module " +
        naming.pkg +
        " is not a complete hexagonal split module (missing " +
        missing.map((file) => path.relative(projectDir, file)).join(", ") +
        "); run go-scaffold check",
    );
  }

  const type = opts.type ?? (await promptMethodType());
  if (opts.getMode && type !== "get") throw new Error("--get-mode can only be used with --type get");
  if (opts.field && !(type === "get" && opts.getMode === "one")) throw new Error("--field can only be used with --type get --get-mode one");
  const getMode = type === "get" ? opts.getMode ?? (await promptGetMode()) : undefined;
  const field = type === "get" && getMode === "one" ? opts.field ?? (await promptLookupField()) : undefined;
  if (field) assertGoIdentifier(toCamelCase(field), "lookup field");
  const method = resolveMethodNaming(methodNameArg ?? (await promptMethodName()));

  if (!hexagonalMarkersPresent(paths)) {
    throw new Error("internal/app/" + naming.pkg + " is missing a split-layout generate-method marker; restore the go-scaffold markers or edit this endpoint by hand");
  }
  assertHexagonalMethodAbsent(paths, method);

  const docsRelativePath = config.features.openapiDocs ? naming.plural + "/methods/" + method.pathSegment + ".yaml" : undefined;
  if (docsRelativePath && fs.existsSync(path.join(projectDir, "docs", docsRelativePath))) {
    throw new Error("OpenAPI method document already exists: docs/" + docsRelativePath);
  }

  const checkBefore = typeChecks(projectDir);
  patchHexagonalMethod(paths, naming, method, { type, getMode, field }, config.goModule);
  gofmtTree(projectDir);
  assertNoDrift(projectDir, checkBefore, config);

  let fieldMigration = "";
  if (field) {
    const migrationsDir = path.join(projectDir, "migrations");
    fieldMigration = newMigrationVersion(migrationsDir);
    const fieldColumn = toDbName(field);
    await applyTemplateEntries(
      projectDir,
      [
        { template: "generate/module/field-column.up.sql.hbs", output: path.join("migrations", fieldMigration + "_add_" + naming.tableName + "_" + fieldColumn + ".up.sql") },
        { template: "generate/module/field-column.down.sql.hbs", output: path.join("migrations", fieldMigration + "_add_" + naming.tableName + "_" + fieldColumn + ".down.sql") },
      ],
      { ...naming, methodName: method.name, fieldColumn },
    );
  }
  if (fieldMigration) {
    console.log("migration: migrations/" + fieldMigration + "_add_" + naming.tableName + "_" + toDbName(field!) + ".{up,down}.sql (adds the column the lookup queries, plus an index on it; check the type before applying)");
  }
  if (docsRelativePath) {
    const docsPath = path.join(projectDir, "docs", docsRelativePath);
    fs.outputFileSync(docsPath, methodOpenapiDocument(naming, method, type, getMode, field));
    patchOpenapiIndexRaw(path.join(projectDir, "docs", "openapi.yaml"), config.apiPrefix, [
      { urlPath: methodRoutePath(naming, method, type, getMode, field), file: "./" + docsRelativePath },
    ]);
  }
  console.log(pc.green("\nadded \"" + method.name + "\" to internal/app/" + naming.pkg + "/"));
  console.log("route: " + routeHint(naming, method, type, config.apiPrefix, getMode, field));
  if (docsRelativePath) console.log(pc.green("docs: docs/" + docsRelativePath + " (wired into docs/openapi.yaml)"));
  const implementationFile = cqrs ? "application/" + (type === "get" ? "queries.go" : "commands.go") : "application/service.go";
  console.log(pc.dim("\nnext: fill in the TODO in " + implementationFile + ", then go build ./... / go test ./..."));
}

export async function generateMethod(
  moduleNameArg: string | undefined,
  methodNameArg: string | undefined,
  opts: GenerateMethodOptions,
  projectDir: string = process.cwd()
): Promise<void> {
  const config = readConfig(projectDir);
  const naming = resolveProjectModuleNaming(
    projectDir,
    moduleNameArg ?? (await promptExistingModule(existingModulePackages(projectDir), "add a method to"))
  );
  if (config.architecture.packageLayout !== "split") {
    throw new Error("this scaffold only supports the canonical hexagonal split layout");
  }
  await generateHexagonalMethod(config, naming, methodNameArg, opts, projectDir);
}
