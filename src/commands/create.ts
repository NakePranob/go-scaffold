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
import { httpConfigFromPreset, presetDirs, resolvePreset } from "../utils/http-contract";
import { writeContractArtifact } from "./contract";
import {
  AGENT_SKILL_NAME,
  assertAgentSkillAvailable,
  writeAgentSkill,
} from "../utils/agent-guidance";

export interface CreateOptions {
  defaults?: boolean;
  goModule?: string;
  plan?: boolean;
  docker?: boolean;
  openapiDocs?: boolean;
  observability?: boolean;
  apiPrefix?: string;
  moduleProfile?: string;
  moduleSurface?: string;
  applicationStyle?: string;
  httpPreset?: string;
  presetDir?: string;
}

export async function createProject(rawName: string | undefined, opts: CreateOptions): Promise<void> {
  const trimmed = (rawName ?? (await promptProjectName())).trim();
  if (!trimmed) throw new Error("project name is required");
  const goModule = opts.goModule ?? trimmed;
  assertValidGoModulePath(goModule);

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
  let httpPreset: string;
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
    httpPreset = opts.httpPreset ?? "default";
  } else {
    // commander gives `--no-x` options a default of true, and there is no
    // `--docker`/`--openapi-docs` to pass, so false here can only mean the
    // caller opted out explicitly. undefined leaves the question to the wizard.
    const wizard = await runCreateWizard({
      docker: opts.docker === false ? false : undefined,
      openapiDocs: opts.openapiDocs === false ? false : undefined,
      observability: opts.observability === true ? true : undefined,
      apiPrefix: opts.apiPrefix,
      moduleProfile,
      moduleSurface,
      applicationStyle,
      httpPreset: opts.httpPreset,
      presetDir: opts.presetDir,
    });
    ({ features, apiPrefix, architecture } = wizard);
    httpPreset = wizard.httpPreset;
  }

  const http = httpConfigFromPreset(resolvePreset(httpPreset, presetDirs(opts.presetDir)).preset);
  const warnings = http.preset === "default"
    ? []
    : [
        `non-default HTTP preset "${http.preset}" is selected; generated Next.js/SvelteKit clients currently assume the default shapes`,
      ];

  const context = {
    projectName,
    goModule,
    dbName: toDbName(projectName),
    apiPrefix,
    ...architecture,
    ...features,
    httpPreset: http.preset,
    httpResolved: http.resolved,
    singleShape: http.resolved.single,
    listShape: http.resolved.list,
    errorShape: http.resolved.error,
  };

  if (opts.plan) {
    const files = CREATE_MANIFEST
      .filter((entry) => !entry.when || entry.when(context))
      .map((entry) => entry.output);
    console.log(JSON.stringify({
      writes: false,
      project: { name: projectName, goModule, apiPrefix, directory: projectDir },
      http: { preset: http.preset, resolved: http.resolved, presetHash: http.presetHash },
      files: [...new Set([...files, "go-scaffold.config.json", "http-contract.json", ".agents/skills/go-scaffold/SKILL.md"])],
      warnings,
    }, null, 2));
    return;
  }

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
    http,
    modules: {},
    scaffoldVersion: cliVersion(),
  });
  writeContractArtifact(projectDir);

  // Composed the same way a user would do it by hand — `create` always
  // renders the plain base, then this layers the same patches `add
  // observability` would apply on an existing project, so the two paths
  // produce identical output.
  if (features.observability) {
    await addObservability(projectDir, { silent: true });
  }

  for (const warning of warnings) console.warn(pc.yellow(`warning: ${warning}`));
  console.log(pc.green(`\ncreated ${projectName}/`));
  console.log(`\ncd ${projectName}`);
  console.log(pc.dim(`agent skill: ${path.relative(process.cwd(), agentSkill.link)}${agentSkill.note ? ` (${agentSkill.note})` : ""}`));
  if (features.docker) console.log(`make docker-up`);
  console.log(`make db-create`);
  console.log(`go mod tidy`);
  console.log(`make run`);
  console.log(pc.dim(`\nadd your first domain: go-scaffold generate module <name>`));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const ANSWER_KEYS = new Set([
  "project.name",
  "project.goModule",
  "projectName",
  "goModule",
  "apiPrefix",
  "features.docker",
  "features.openapiDocs",
  "features.observability",
  "docker",
  "openapiDocs",
  "observability",
  "http.preset",
  "httpPreset",
  "architecture.moduleProfile",
  "moduleProfile",
]);

function readAnswer(answers: Record<string, unknown>, dotted: string, flat: string): unknown {
  return answers[dotted] ?? answers[flat];
}

export interface CreateAnswersOptions {
  plan?: boolean;
  apply?: boolean;
  presetDir?: string;
}

export async function createFromAnswers(file: string, opts: CreateAnswersOptions): Promise<void> {
  if (opts.plan && opts.apply) {
    throw new Error("--plan and --apply are mutually exclusive");
  }
  if (!opts.plan && !opts.apply) {
    throw new Error("choose --plan to inspect the file list, or --apply to create the project");
  }

  const resolved = path.resolve(file);
  const raw = fs.readJsonSync(resolved);
  if (!isRecord(raw)) throw new Error(`${resolved} must contain a JSON object`);
  for (const key of Object.keys(raw)) {
    if (!ANSWER_KEYS.has(key)) throw new Error(`${resolved}: unknown answer "${key}"`);
  }

  const name = readAnswer(raw, "project.name", "projectName");
  if (typeof name !== "string" || !name.trim()) {
    throw new Error(`${resolved}: project.name is required`);
  }
  const goModule = readAnswer(raw, "project.goModule", "goModule");
  if (goModule !== undefined && (typeof goModule !== "string" || !goModule.trim())) {
    throw new Error(`${resolved}: project.goModule must be a non-empty string`);
  }
  const apiPrefix = raw.apiPrefix ?? "";
  if (typeof apiPrefix !== "string") throw new Error(`${resolved}: apiPrefix must be a string`);

  const bool = (key: string, flat: string, fallback: boolean): boolean => {
    const value = readAnswer(raw, key, flat);
    if (value === undefined) return fallback;
    if (typeof value !== "boolean") throw new Error(`${resolved}: ${key} must be true or false`);
    return value;
  };

  const httpPreset = readAnswer(raw, "http.preset", "httpPreset");
  const moduleProfile = readAnswer(raw, "architecture.moduleProfile", "moduleProfile");

  await createProject(name.trim(), {
    defaults: true,
    plan: opts.plan,
    goModule: typeof goModule === "string" ? goModule.trim() : undefined,
    docker: bool("features.docker", "docker", true),
    openapiDocs: bool("features.openapiDocs", "openapiDocs", true),
    observability: bool("features.observability", "observability", false),
    apiPrefix,
    moduleProfile: typeof moduleProfile === "string" ? moduleProfile : "lean",
    httpPreset: typeof httpPreset === "string" ? httpPreset : "default",
    presetDir: opts.presetDir,
  });
}
