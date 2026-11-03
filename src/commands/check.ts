import fs from "fs-extra";
import path from "path";
import pc from "picocolors";
import { readConfig } from "../utils/config";
import { ModuleConfig, ProjectConfig } from "../types";

type Layer = "domain" | "application" | "ports" | "inbound" | "outbound" | "composition";

// Package paths end at `(?:\/|$)`, not at `\/`: `internal/shared/tx` is the
// package itself and must match as surely as a subpackage of it does.
const forbiddenByLayer: Record<Exclude<Layer, "composition">, RegExp[]> = {
  domain: [
    /github\.com\/gin-gonic\/gin/,
    /gorm\.io\//,
    /net\/http/,
    /internal\/(shared|platform)(?:\/|$)/,
    /^github\.com\/redis\/go-redis(?:\/|$)/,
  ],
  application: [
    /github\.com\/gin-gonic\/gin/,
    /gorm\.io\//,
    /database\/sql/,
    /internal\/platform(?:\/|$)/,
    /internal\/shared\/(apperror|httpx|middleware|tx|dberr)(?:\/|$)/,
    /^github\.com\/redis\/go-redis(?:\/|$)/,
  ],
  ports: [
    /github\.com\/gin-gonic\/gin/,
    /gorm\.io\//,
    /database\/sql/,
    /internal\/platform(?:\/|$)/,
    /internal\/shared\/(apperror|httpx|middleware|tx|dberr)(?:\/|$)/,
    /^github\.com\/redis\/go-redis(?:\/|$)/,
  ],
  inbound: [/gorm\.io\//, /internal\/platform(?:\/|$)/],
  outbound: [/github\.com\/gin-gonic\/gin/, /internal\/shared\/(httpx|middleware)(?:\/|$)/],
};

// A split module is not hexagonal merely because its folders have the right
// names. Keep dependencies flowing toward the application core. Composition
// is the only module-local exception because it is the explicit wiring edge.
const forbiddenInternalLayers: Record<Exclude<Layer, "composition">, Layer[]> = {
  domain: ["application", "ports", "inbound", "outbound", "composition"],
  ports: ["application", "inbound", "outbound", "composition"],
  application: ["inbound", "outbound", "composition"],
  inbound: ["outbound", "composition"],
  outbound: ["application", "inbound", "composition"],
};

function goFiles(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  const files: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const entryPath = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...goFiles(entryPath));
    else if (entry.isFile() && entry.name.endsWith(".go")) files.push(entryPath);
  }
  return files;
}

function directoriesNamed(dir: string, names: Set<string>): string[] {
  if (!fs.existsSync(dir)) return [];
  const found: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const entryPath = path.join(dir, entry.name);
    if (names.has(entry.name)) found.push(entryPath);
    found.push(...directoriesNamed(entryPath, names));
  }
  return found;
}

function imports(content: string): string[] {
  const found: string[] = [];
  for (const match of content.matchAll(/^\s*(?:import\s+)?(?:[._\w]+\s+)?"([^"]+)"\s*$/gm)) found.push(match[1]);
  return found;
}

// layerOf maps a slash-separated path inside a module — a file or an import —
// to its layer. Every transport under adapters/inbound/ (http, ws, grpc, ...)
// is inbound and every store under adapters/outbound/ is outbound, so a new
// adapter folder inherits its side's rules instead of escaping them.
function layerOf(relative: string): Layer | undefined {
  const [top, side] = relative.split("/");
  if (top === "domain" || top === "application" || top === "ports") return top;
  if (top === "adapters" && (side === "inbound" || side === "outbound")) return side;
  if (relative === "composition.go" || relative === "composition") return "composition";
  return undefined;
}

function internalLayer(imported: string, moduleName: string): Layer | undefined {
  const match = imported.match(/(?:^|\/)internal\/app\/([^/]+)\/(.+)$/);
  if (!match || match[1] !== moduleName) return undefined;
  return layerOf(match[2]);
}

function siblingModule(imported: string, current: string): string | undefined {
  const match = imported.match(/(?:^|\/)internal\/app\/([^/]+)(?:\/|$)/);
  if (!match || match[1] === current) return undefined;
  return match[1];
}

function appImport(imported: string): { module: string; privatePath: string } | undefined {
  const match = imported.match(/(?:^|\/)internal\/app\/([^/]+)(?:\/(.*))?$/);
  if (!match) return undefined;
  return { module: match[1], privatePath: match[2] ?? "" };
}

function moduleNames(projectDir: string, config: ProjectConfig): string[] {
  const appDir = path.join(projectDir, "internal", "app");
  const discovered = fs.existsSync(appDir)
    ? fs.readdirSync(appDir, { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => entry.name)
    : [];
  return [...new Set([...Object.keys(config.modules), ...discovered])].sort();
}

function expectedFiles(moduleDir: string, module: ModuleConfig): string[] {
  const required = ["composition.go", "domain/entity.go", "domain/errors.go", "adapters/inbound/http/handler.go"];
  // A "none" module owns no table: no repository port, persistence adapter,
  // or the DTO seams `generate method` writes into.
  if (module.surface !== "none") {
    required.push(
      "ports/repository.go",
      "application/dto.go",
      "adapters/inbound/http/dto.go",
      "adapters/outbound/postgres/model.go",
      "adapters/outbound/postgres/repository.go"
    );
  }
  if (module.applicationStyle === "service") required.push("application/service.go");
  else required.push("application/commands.go", "application/queries.go");
  return required.map((file) => path.join(moduleDir, file));
}

function checkModule(projectDir: string, name: string, module: ModuleConfig | undefined, warnings: string[]): string[] {
  const errors: string[] = [];
  const moduleDir = path.join(projectDir, "internal", "app", name);
  if (!module) {
    errors.push(`internal/app/${name}: missing module metadata in go-scaffold.config.json`);
    return errors;
  }
  if (module.boundary !== "hexagonal" || module.packageLayout !== "split") {
    errors.push(`internal/app/${name}: module must declare boundary=hexagonal and packageLayout=split`);
  }
  for (const forbidden of directoriesNamed(moduleDir, new Set(["model"]))) {
    errors.push(`${path.relative(projectDir, forbidden)}: feature-level model package is forbidden; keep persistence models in the outbound adapter`);
  }
  for (const forbidden of directoriesNamed(moduleDir, new Set(["compat"]))) {
    errors.push(`${path.relative(projectDir, forbidden)}: feature-level compat directory is forbidden; keep legacy compatibility out of the canonical split architecture`);
  }
  for (const file of expectedFiles(moduleDir, module)) {
    if (!fs.existsSync(file)) errors.push(`${path.relative(projectDir, file)}: required by the split module contract`);
  }
  const applicationDir = path.join(moduleDir, "application");
  if (module.applicationStyle === "cqrs" && fs.existsSync(path.join(applicationDir, "service.go"))) {
    errors.push(`internal/app/${name}: CQRS module must not contain application/service.go; use commands.go and queries.go`);
  }
  if (module.applicationStyle === "cqrs" && fs.existsSync(path.join(applicationDir, "service_test.go"))) {
    errors.push(`internal/app/${name}: CQRS module must not contain application/service_test.go; use cqrs_test.go`);
  }
  if (module.applicationStyle === "service" && (fs.existsSync(path.join(applicationDir, "commands.go")) || fs.existsSync(path.join(applicationDir, "queries.go")))) {
    errors.push(`internal/app/${name}: service module must not contain application/commands.go or queries.go`);
  }
  if (module.applicationStyle === "service" && fs.existsSync(path.join(applicationDir, "cqrs_test.go"))) {
    errors.push(`internal/app/${name}: service module must not contain application/cqrs_test.go; use service_test.go`);
  }

  // Walk every file rather than a list of known folders: a folder check does
  // not know about is exactly where a forbidden import would otherwise hide.
  const unlayered = new Set<string>();
  for (const file of goFiles(moduleDir)) {
    const relative = path.relative(moduleDir, file).split(path.sep).join("/");
    const shown = path.relative(projectDir, file);
    const atRoot = !relative.includes("/");
    const layer = layerOf(relative);
    if (!layer && !atRoot) unlayered.add(path.dirname(shown));
    const content = fs.readFileSync(file, "utf8");
    for (const imported of imports(content)) {
      if (/\/internal\/app\/[^/]+\/model(?:\/|$)/.test(imported)) {
        errors.push(`${shown}: imports a forbidden feature-level model package ${imported}`);
      }
      // Other root files are either the root rule's error below or an
      // external composition test, which adds no dependency edge.
      if (atRoot && layer !== "composition") continue;
      const other = siblingModule(imported, name);
      if (other) {
        errors.push(`${shown}: imports sibling module ${other}; use a port and process composition`);
      }
      if (!layer || layer === "composition") continue;
      if (forbiddenByLayer[layer].some((pattern) => pattern.test(imported))) {
        errors.push(`${shown}: ${layer} layer imports forbidden dependency ${imported}`);
      }
      const importedLayer = internalLayer(imported, name);
      if (importedLayer && forbiddenInternalLayers[layer].includes(importedLayer)) {
        errors.push(`${shown}: ${layer} layer imports forbidden internal layer ${imported}`);
      }
    }
    if (layer === "application" && path.basename(file) === "dto.go" && content.includes("json:")) {
      errors.push(`${shown}: application DTOs must be transport-neutral; keep JSON tags in adapters/inbound/http/dto.go`);
    }
  }
  for (const dir of unlayered) {
    warnings.push(
      `${dir}: not a layer check knows (domain, application, ports, adapters/inbound/**, adapters/outbound/**); only the sibling-module rule applies to its files`
    );
  }
  const rootGoFiles = fs.existsSync(moduleDir)
    ? fs
        .readdirSync(moduleDir, { withFileTypes: true })
        // `_test.go` excluded: the rule is about where implementation lives,
        // and `package <mod>_test` beside composition.go is the only place Go
        // lets you test the composition root end to end. It is imported by
        // nothing and adds no dependency edge, so it is not a layout breach.
        .filter((entry) => entry.isFile() && entry.name.endsWith(".go") && !entry.name.endsWith("_test.go"))
        .map((entry) => path.join(moduleDir, entry.name))
    : [];
  for (const file of rootGoFiles) {
    if (path.basename(file) !== "composition.go") {
      errors.push(`${path.relative(projectDir, file)}: root module package may only contain composition.go`);
    }
  }
  return errors;
}

function checkProcessComposition(projectDir: string): string[] {
  const errors: string[] = [];
  const compositionDir = path.join(projectDir, "internal", "composition");
  const docPath = path.join(compositionDir, "doc.go");
  if (!fs.existsSync(docPath)) {
    errors.push("internal/composition/doc.go: required process-level composition package");
  }

  for (const file of goFiles(compositionDir)) {
    const content = fs.readFileSync(file, "utf8");
    for (const imported of imports(content)) {
      const feature = appImport(imported);
      if (feature?.privatePath) {
        errors.push(
          `${path.relative(projectDir, file)}: process composition must import the public internal/app/${feature.module} package, not private path ${imported}`
        );
      }
    }
  }

  // wiring.go is allowed to see every feature package because it is the
  // executable's root. Other cmd/api files must not become hidden
  // cross-feature adapters; those belong here so integration tests can reuse
  // the same mapping without importing package main.
  const apiDir = path.join(projectDir, "cmd", "api");
  for (const file of goFiles(apiDir)) {
    const base = path.basename(file);
    if (base === "main.go" || base === "wiring.go") continue;
    for (const imported of imports(fs.readFileSync(file, "utf8"))) {
      if (appImport(imported)) {
        errors.push(
          `${path.relative(projectDir, file)}: process-level feature adapters belong in internal/composition; keep cmd/api for entrypoint and wiring`
        );
        break;
      }
    }
  }
  return errors;
}

export function checkProject(projectDir: string = process.cwd()): void {
  const config = readConfig(projectDir);
  const errors: string[] = [];
  if (config.architecture.style !== "modular-monolith") errors.push("architecture.style must be modular-monolith");
  if (config.architecture.boundary !== "hexagonal") errors.push("architecture.boundary must be hexagonal");
  if (config.architecture.packageLayout !== "split") errors.push("architecture.packageLayout must be split");
  errors.push(...checkProcessComposition(projectDir));
  const warnings: string[] = [];
  for (const name of moduleNames(projectDir, config)) errors.push(...checkModule(projectDir, name, config.modules[name], warnings));
  for (const warning of warnings) console.warn(pc.yellow(`warning: ${warning}`));
  if (errors.length) {
    throw new Error(`${pc.red("architecture check failed")}:\n${errors.map((error) => `  - ${error}`).join("\n")}`);
  }
  console.log(pc.green(`architecture check passed: ${moduleNames(projectDir, config).length} split module(s), hexagonal boundary`));
  if (config.asvs) {
    const required = [
      "docs/security/asvs-auth.md",
      "internal/shared/middleware/auth.go",
      "internal/app/user/application/local_auth.go",
      "internal/app/user/application/mfa_service.go",
      "internal/app/user/application/security_profile.go",
      "internal/app/user/application/password_policy.go",
      "internal/app/user/adapters/outbound/password/policy.go",
      "internal/app/user/composition.go",
    ];
    const missing = required.filter((file) => !fs.existsSync(path.join(projectDir, file)));
    if (missing.length) throw new Error(`ASVS generated security profile check failed: missing ${missing.join(", ")}`);
    const worksheet = fs.readFileSync(path.join(projectDir, required[0]), "utf8");
    if (!worksheet.includes(`OWASP ASVS ${config.asvs.version} Level ${config.asvs.level}`)) {
      throw new Error("ASVS generated security profile check failed: docs/security/asvs-auth.md does not match the profile recorded in go-scaffold.config.json");
    }
    if (config.asvs.level >= 3) {
      throw new Error("ASVS generated security profile check failed: L3 requires a generated phishing-resistant WebAuthn/passkey adapter");
    }
    const profile = fs.readFileSync(path.join(projectDir, "internal/app/user/application/security_profile.go"), "utf8");
    const composition = fs.readFileSync(path.join(projectDir, "internal/app/user/composition.go"), "utf8");
    if (!new RegExp(`Level:\\s+${config.asvs.level},`).test(profile)) {
      throw new Error("ASVS generated security profile check failed: security_profile.go does not match the selected level");
    }
    if (!/CommonPasswordScreening:\s+true/.test(profile)) {
      throw new Error("ASVS generated security profile check failed: common-password screening is disabled");
    }
    if (config.asvs.level === 2 && (!/ContextPasswordScreening:\s+true/.test(profile) || !/BreachedPasswordScreening:\s+true/.test(profile) || !/RequireMFAForSensitiveActions:\s+true/.test(profile) || !/RequireMFAForApplicationAccess:\s+true/.test(profile) || !/cfg\.AuthMFAEnabled/.test(composition) || !/cfg\.AuthMFARequiredForLogin/.test(composition))) {
      throw new Error("ASVS generated security profile check failed: L2 controls are disabled");
    }
    console.log(`ASVS ${config.asvs.version} L${config.asvs.level} generated security profile: present; runtime and deployment evidence still require review`);
    if (config.asvs.level === 2) {
      console.log("  - L2 production guard: configure AUTH_COMMON_PASSWORDS_FILE, AUTH_CONTEXT_PASSWORDS_FILE, AUTH_BREACHED_PASSWORDS_FILE, AUTH_MFA_ENABLED=true and AUTH_MFA_REQUIRED_FOR_LOGIN=true");
    } else {
      console.log("  - L1 production guard: configure AUTH_COMMON_PASSWORDS_FILE with at least the top 3000 policy-matching passwords");
    }
    console.log("  - L3 is intentionally unavailable until a phishing-resistant WebAuthn/passkey adapter is generated");
    const unresolvedChoices = [
      config.features.authBrowserTopology === undefined ? "features.authBrowserTopology" : undefined,
      config.features.authLockout === undefined ? "features.authLockout" : undefined,
    ].filter((value): value is string => value !== undefined);
    if (unresolvedChoices.length) {
      console.warn(`  - unresolved auth wizard choices in go-scaffold.config.json: ${unresolvedChoices.join(", ")} (legacy project; inspect manually)`);
    }
  }
}
