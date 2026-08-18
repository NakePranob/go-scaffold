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
import { resolveProjectModuleNaming } from "../utils/module-location";
import { MethodPatchPaths, markersPresent, patchMethod } from "../utils/method-patcher";
import { assertNoDrift, typeChecks } from "../utils/gocheck";
import { gofmtTree } from "../utils/template-renderer";
import { patchOpenapiIndexRaw } from "../utils/openapi-patcher";
import {
  promptGetMode,
  promptLookupField,
  promptMethodName,
  promptMethodType,
  promptModuleName,
} from "../prompts/generate-wizard";
import { GetMethodMode, MethodType, ModuleNaming, MethodNaming } from "../types";

// URL path registered in method-patcher.ts, excluding the project-wide API
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

  const status = type === "delete" ? "204" : type === "post" ? "201" : "200";
  operation.push("  responses:", `    \"${status}\":`, `      description: ${type === "delete" ? "completed or already absent" : "TODO define response"}`);
  if (type !== "delete") {
    operation.push(
      "      content:",
      "        application/json:",
      "          schema:",
      "            type: object",
      "            description: TODO replace with the method response schema"
    );
  }
  operation.push("    \"400\": { $ref: '../../common/responses.yaml#/ValidationError' }");
  if (type === "get" || type === "put" || type === "patch") {
    operation.push("    \"404\": { $ref: '../../common/responses.yaml#/NotFoundError' }");
  }

  return [...pathParameters, ...operation, ""].join("\n");
}

export interface GenerateMethodOptions {
  type?: MethodType;
  getMode?: GetMethodMode;
  field?: string;
}

export async function generateMethod(
  moduleNameArg: string | undefined,
  methodNameArg: string | undefined,
  opts: GenerateMethodOptions,
  projectDir: string = process.cwd()
): Promise<void> {
  const config = readConfig(projectDir);
  const naming = resolveProjectModuleNaming(projectDir, moduleNameArg ?? (await promptModuleName()));
  const modulePath = naming.pkg;

  const moduleDir = path.join(projectDir, "internal", "app", modulePath);
  const paths: MethodPatchPaths = {
    dtoPath: path.join(moduleDir, "dto.go"),
    repositoryPath: path.join(moduleDir, "repository.go"),
    servicePath: path.join(moduleDir, "service.go"),
    handlerPath: path.join(moduleDir, "handler.go"),
    serviceTestPath: path.join(moduleDir, "service_test.go"),
  };

  for (const p of Object.values(paths)) {
    if (!fs.existsSync(p)) {
      throw new Error(
        `module "${naming.pkg}" not found at ${moduleDir} (missing ${path.basename(p)}) — ` +
          `run \`go-scaffold generate module ${naming.pkg}\` first`
      );
    }
  }

  const type = opts.type ?? (await promptMethodType());
  if (opts.getMode && type !== "get") {
    throw new Error("--get-mode can only be used with --type get");
  }
  if (opts.field && !(type === "get" && opts.getMode === "one")) {
    throw new Error("--field can only be used with --type get --get-mode one");
  }
  const getMode = type === "get" ? opts.getMode ?? (await promptGetMode()) : undefined;
  const field = type === "get" && getMode === "one" ? opts.field ?? (await promptLookupField()) : undefined;
  // field becomes a Go param name (`func (...)(ctx, <field> string)`) and a
  // column name in the generated `WHERE <field> = ?`
  if (field) assertGoIdentifier(toCamelCase(field), "lookup field");

  const method = resolveMethodNaming(methodNameArg ?? (await promptMethodName()));

  // Every marker this command patches has to exist before the first write:
  // patchMethod writes dto.go, then handler.go, then reads service.go, so a
  // missing service marker used to leave two files patched and the method
  // permanently un-retryable (assertNotDuplicate then sees it as existing).
  if (!markersPresent(paths.handlerPath, paths.servicePath)) {
    throw new Error(
      `internal/app/${naming.pkg} is missing the marker comments \`generate method\` patches at.\n` +
        `handler.go and service.go must both still carry their \`// go-scaffold:*\` markers —\n` +
        `restore them, or add this method by hand.`
    );
  }
  const docsRelativePath = config.features.openapiDocs
    ? `${naming.plural}/methods/${method.pathSegment}.yaml`
    : undefined;
  if (docsRelativePath && fs.existsSync(path.join(projectDir, "docs", docsRelativePath))) {
    throw new Error(`OpenAPI method document already exists: docs/${docsRelativePath}`);
  }

  const checkBefore = typeChecks(projectDir);
  patchMethod(paths, naming, method, { type, getMode, field }, config.goModule);
  gofmtTree(projectDir);
  assertNoDrift(projectDir, checkBefore, config);

  if (docsRelativePath) {
    const docsPath = path.join(projectDir, "docs", docsRelativePath);
    fs.outputFileSync(docsPath, methodOpenapiDocument(naming, method, type, getMode, field));
    patchOpenapiIndexRaw(path.join(projectDir, "docs", "openapi.yaml"), config.apiPrefix, [
      {
        urlPath: methodRoutePath(naming, method, type, getMode, field),
        file: `./${docsRelativePath}`,
      },
    ]);
  }

  console.log(pc.green(`\nadded "${method.name}" to internal/app/${modulePath}/`));
  console.log(`route: ${routeHint(naming, method, type, config.apiPrefix, getMode, field)}`);
  if (docsRelativePath) {
    console.log(pc.green(`docs: docs/${docsRelativePath} (wired into docs/openapi.yaml)`));
  }
  console.log(pc.dim(`\nnext: fill in the TODO in service.go, then \`go build ./...\` / \`go test ./...\``));
}
