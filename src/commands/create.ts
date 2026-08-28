import path from "path";
import fs from "fs-extra";
import pc from "picocolors";
import { applyTemplateEntries, gofmtTree } from "../utils/template-renderer";
import { CREATE_MANIFEST } from "../templates/create-manifest";
import { parseApplicationStyle, parseModuleProfile, parseModuleSurface, writeConfig } from "../utils/config";
import { assertValidGoModulePath, normalizeApiPrefix, toDbName, validateApiPrefix } from "../utils/naming";
import { promptProjectName, runCreateWizard } from "../prompts/create-wizard";
import { cliVersion } from "../utils/version";
import { ArchitectureConfig, DEFAULT_ARCHITECTURE_CONFIG, ProjectFeatures } from "../types";
import { addObservability } from "./observability";
import { architectureForModuleProfile } from "../utils/module-profile";

export interface CreateOptions {
  defaults?: boolean;
  docker?: boolean;
  openapiDocs?: boolean;
  observability?: boolean;
  apiPrefix?: string;
  moduleProfile?: string;
  moduleSurface?: string;
  applicationStyle?: string;
}

export async function createProject(rawName: string | undefined, opts: CreateOptions): Promise<void> {
  const trimmed = (rawName ?? (await promptProjectName())).trim();
  if (!trimmed) throw new Error("project name is required");
  assertValidGoModulePath(trimmed);

  const goModule = trimmed;
  const projectName = trimmed.includes("/") ? trimmed.split("/").pop()! : trimmed;
  const projectDir = path.resolve(process.cwd(), projectName);

  if (fs.existsSync(projectDir) && fs.readdirSync(projectDir).length > 0) {
    throw new Error(`${projectDir} already exists and is not empty`);
  }

  let features: ProjectFeatures;
  let apiPrefix: string;
  let architecture: ArchitectureConfig;
  const moduleProfile = parseModuleProfile(opts.moduleProfile, "--module-profile");
  const moduleSurface = parseModuleSurface(opts.moduleSurface);
  const applicationStyle = parseApplicationStyle(opts.applicationStyle);
  if (moduleProfile && (moduleSurface || applicationStyle)) {
    throw new Error("--module-profile cannot be combined with --module-surface or --application-style — choose one configuration style");
  }
  if (opts.defaults) {
    features = { docker: opts.docker ?? true, openapiDocs: opts.openapiDocs ?? true, observability: opts.observability ?? false };
    // "" to match what the wizard's Enter now gives. --defaults means "don't
    // ask me", not "give me something I didn't ask for", and a prefix is a
    // project-wide decision you cannot change later without rewriting routes
    // and every OpenAPI path.
    apiPrefix = normalizeApiPrefix(opts.apiPrefix ?? "");
    const check = validateApiPrefix(apiPrefix);
    if (check !== true) throw new Error(check);
    const profileArchitecture = moduleProfile ? architectureForModuleProfile(moduleProfile) : undefined;
    architecture = {
      ...DEFAULT_ARCHITECTURE_CONFIG,
      ...(profileArchitecture ? { defaultModuleSurface: profileArchitecture.moduleSurface } : {}),
      ...(profileArchitecture ? { defaultApplicationStyle: profileArchitecture.applicationStyle } : {}),
      ...(!profileArchitecture && moduleSurface ? { defaultModuleSurface: moduleSurface } : {}),
      ...(!profileArchitecture && applicationStyle ? { defaultApplicationStyle: applicationStyle } : {}),
    };
  } else {
    // commander gives `--no-x` options a default of true, and there is no
    // `--docker`/`--openapi-docs` to pass, so false here can only mean the
    // caller opted out explicitly. undefined leaves the question to the wizard.
    ({ features, apiPrefix, architecture } = await runCreateWizard({
      docker: opts.docker === false ? false : undefined,
      openapiDocs: opts.openapiDocs === false ? false : undefined,
      observability: opts.observability === true ? true : undefined,
      apiPrefix: opts.apiPrefix,
      moduleProfile,
      moduleSurface,
      applicationStyle,
    }));
  }

  const context = {
    projectName,
    goModule,
    dbName: toDbName(projectName),
    apiPrefix,
    ...architecture,
    ...features,
  };

  await fs.ensureDir(projectDir);
  await applyTemplateEntries(projectDir, CREATE_MANIFEST, context);
  gofmtTree(projectDir);
  writeConfig(projectDir, {
    schemaVersion: 1,
    projectName,
    goModule,
    apiPrefix,
    features,
    architecture,
    modules: {},
    scaffoldVersion: cliVersion(),
  });

  // Composed the same way a user would do it by hand — `create` always
  // renders the plain base, then this layers the same patches `add
  // observability` would apply on an existing project, so the two paths
  // produce identical output.
  if (features.observability) {
    await addObservability(projectDir, { silent: true });
  }

  console.log(pc.green(`\ncreated ${projectName}/`));
  console.log(`\ncd ${projectName}`);
  if (features.docker) console.log(`make docker-up`);
  console.log(`make db-create`);
  console.log(`go mod tidy`);
  console.log(`make run`);
  console.log(pc.dim(`\nadd your first domain: go-scaffold generate module <name>`));
}
