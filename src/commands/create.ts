import path from "path";
import fs from "fs-extra";
import pc from "picocolors";
import { applyTemplateEntries, getTemplatesRoot, gofmtTree, renderString } from "../utils/template-renderer";
import { CREATE_MANIFEST } from "../templates/create-manifest";
import { parseApplicationStyle, parseModuleProfile, parseModuleSurface, writeConfig } from "../utils/config";
import { assertValidGoModulePath, normalizeApiPrefix, toDbName, validateApiPrefix } from "../utils/naming";
import { promptProjectName, runCreateWizard } from "../prompts/create-wizard";
import { cliVersion } from "../utils/version";
import { ArchitectureConfig, DEFAULT_ARCHITECTURE_CONFIG, ProjectFeatures } from "../types";
import { CONFIG_SCHEMA_VERSION } from "../utils/config";
import { addObservability } from "./observability";
import { architectureForModuleProfile } from "../utils/module-profile";
import {
  AGENT_SKILL_NAME,
  assertAgentSkillAvailable,
  writeAgentSkill,
} from "../utils/agent-guidance";

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

  // Agent tooling loads skills from the repository root, not from a package
  // folder in a monorepo. Keep AGENTS.md/CLAUDE.md package-specific, but put
  // one generic skill at the git root for every generated package.

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

  const skillTemplate = await fs.readFile(
    path.join(getTemplatesRoot(), "create/base/.claude/skills/go-scaffold/SKILL.md.hbs"),
    "utf8"
  );
  const skillContent = renderString(skillTemplate, context);
  // Check before writing any project files: a skill-name collision must not
  // leave a half-created package behind.
  assertAgentSkillAvailable(projectDir, AGENT_SKILL_NAME, skillContent);

  await fs.ensureDir(projectDir);
  await applyTemplateEntries(projectDir, CREATE_MANIFEST, context);
  const agentSkill = writeAgentSkill(projectDir, AGENT_SKILL_NAME, { "SKILL.md": skillContent });
  gofmtTree(projectDir);
  writeConfig(projectDir, {
    schemaVersion: CONFIG_SCHEMA_VERSION,
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
  console.log(pc.dim(`agent skill: ${path.relative(process.cwd(), agentSkill.link)}${agentSkill.note ? ` (${agentSkill.note})` : ""}`));
  if (features.docker) console.log(`make docker-up`);
  console.log(`make db-create`);
  console.log(`go mod tidy`);
  console.log(`make run`);
  console.log(pc.dim(`\nadd your first domain: go-scaffold generate module <name>`));
}
