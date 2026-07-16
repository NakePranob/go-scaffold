import path from "path";
import fs from "fs-extra";
import pc from "picocolors";
import { readConfig } from "../utils/config";
import {
  assertNotGoKeyword,
  resolveMethodNaming,
  resolveModuleNaming,
  toCamelCase,
  toDbName,
} from "../utils/naming";
import { MethodPatchPaths, patchMethod } from "../utils/method-patcher";
import { gofmtTree } from "../utils/template-renderer";
import {
  promptExistingVersion,
  promptGetMode,
  promptLookupField,
  promptMethodName,
  promptMethodType,
  promptModuleName,
} from "../prompts/generate-wizard";
import { versionsContainingModule } from "../utils/module-paths";
import { GetMethodMode, MethodType, ModuleNaming, MethodNaming } from "../types";

// the actual URL the new route answers on — printed so the user can add the
// matching openapi.yaml entry by hand (methods are deliberately not wired into
// the spec; see the note in docs/openapi.yaml). Mirrors the paths registered
// in method-patcher.ts.
function routeHint(
  naming: ModuleNaming,
  method: MethodNaming,
  type: MethodType,
  urlPrefix: string,
  getMode?: GetMethodMode,
  field?: string
): string {
  const base = `/${urlPrefix}/${naming.plural}`;
  if (type === "get" && getMode === "all") return `GET ${base}/${method.pathSegment}`;
  if (type === "get") return `GET ${base}/${toDbName(field ?? "")}/{${toCamelCase(field ?? "")}}`;
  if (type === "post") return `POST ${base}/${method.pathSegment}`;
  if (type === "delete") return `DELETE ${base}/{id}/${method.pathSegment}`;
  return `${type.toUpperCase()} ${base}/{id}/${method.pathSegment}`;
}

export interface GenerateMethodOptions {
  moduleVersion?: string;
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
  const naming = resolveModuleNaming(moduleNameArg ?? (await promptModuleName()));

  let modulePath = naming.pkg;
  let version: string | undefined;
  if (config.features.versioning) {
    if (opts.moduleVersion) {
      version = opts.moduleVersion;
      if (!/^[a-z][a-z0-9]*$/.test(version)) {
        throw new Error(`invalid --module-version "${version}" — expected a bare identifier like v1, v2`);
      }
    } else {
      // no flag: find which version(s) actually hold this module. A module
      // can legitimately exist in more than one version at once, so pick
      // automatically when there's exactly one match, prompt when ambiguous.
      const matches = versionsContainingModule(projectDir, naming.pkg);
      version = matches.length > 1 ? await promptExistingVersion(matches) : matches[0] ?? "v1";
    }
    modulePath = `${version}/${naming.pkg}`;
  } else if (opts.moduleVersion) {
    throw new Error(
      "--module-version was passed but this project doesn't have versioning enabled (see go-scaffold.config.json)"
    );
  }

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
  // field becomes a Go param name (`func (...)(ctx, <field> string)`)
  if (field) assertNotGoKeyword(toCamelCase(field), "lookup field");

  const method = resolveMethodNaming(methodNameArg ?? (await promptMethodName()));

  patchMethod(paths, naming, method, { type, getMode, field }, config.goModule);
  gofmtTree(projectDir);

  console.log(pc.green(`\nadded "${method.name}" to internal/app/${modulePath}/`));
  console.log(`route: ${routeHint(naming, method, type, version ?? "v1", getMode, field)}`);
  if (config.features.openapiDocs) {
    console.log(
      pc.yellow(
        `docs: add this route to docs/openapi.yaml by hand — \`generate method\` doesn't touch the spec`
      )
    );
  }
  console.log(pc.dim(`\nnext: fill in the TODO in service.go, then \`go build ./...\` / \`go test ./...\``));
}
