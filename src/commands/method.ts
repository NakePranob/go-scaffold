import path from "path";
import fs from "fs-extra";
import pc from "picocolors";
import { readConfig } from "../utils/config";
import { resolveMethodNaming, resolveModuleNaming } from "../utils/naming";
import { MethodPatchPaths, patchMethod } from "../utils/method-patcher";
import { gofmtTree } from "../utils/template-renderer";
import {
  promptGetMode,
  promptLookupField,
  promptMethodName,
  promptMethodType,
  promptModuleName,
} from "../prompts/generate-wizard";
import { GetMethodMode, MethodType } from "../types";

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
  if (config.features.versioning) {
    const version = opts.moduleVersion ?? "v1";
    if (!/^[a-z][a-z0-9]*$/.test(version)) {
      throw new Error(`invalid --module-version "${version}" — expected a bare identifier like v1, v2`);
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

  const method = resolveMethodNaming(methodNameArg ?? (await promptMethodName()));

  patchMethod(paths, naming, method, { type, getMode, field }, config.goModule);
  gofmtTree(projectDir);

  console.log(pc.green(`\nadded "${method.name}" to internal/app/${modulePath}/`));
  console.log(pc.dim(`\nnext: fill in the TODO in service.go, then \`go build ./...\` / \`go test ./...\``));
}
