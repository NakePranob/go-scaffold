import fs from "fs-extra";
import path from "path";
import pc from "picocolors";
import { readConfig } from "../utils/config";
import { ModuleConfig, ProjectConfig } from "../types";

type Layer = "domain" | "application" | "ports" | "inbound" | "outbound" | "composition";

const forbiddenByLayer: Record<Exclude<Layer, "composition">, RegExp[]> = {
  domain: [
    /github\.com\/gin-gonic\/gin/,
    /gorm\.io\//,
    /net\/http/,
    /internal\/(shared|platform)\//,
    /redis/,
  ],
  application: [
    /github\.com\/gin-gonic\/gin/,
    /gorm\.io\//,
    /database\/sql/,
    /internal\/platform\//,
    /internal\/shared\/(apperror|httpx|middleware|tx|dberr)\//,
    /redis/,
  ],
  ports: [
    /github\.com\/gin-gonic\/gin/,
    /gorm\.io\//,
    /database\/sql/,
    /internal\/platform\//,
    /internal\/shared\/(apperror|httpx|middleware|tx|dberr)\//,
    /redis/,
  ],
  inbound: [/gorm\.io\//, /internal\/platform\//],
  outbound: [/github\.com\/gin-gonic\/gin/, /internal\/shared\/httpx\//, /internal\/shared\/middleware\//],
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

function internalLayer(imported: string, moduleName: string): Layer | undefined {
  const match = imported.match(/(?:^|\/)internal\/app\/([^/]+)\/(.+)$/);
  if (!match || match[1] !== moduleName) return undefined;
  const relative = match[2];
  if (relative === "domain" || relative.startsWith("domain/")) return "domain";
  if (relative === "application" || relative.startsWith("application/")) return "application";
  if (relative === "ports" || relative.startsWith("ports/")) return "ports";
  if (relative === "adapters/inbound" || relative.startsWith("adapters/inbound/")) return "inbound";
  if (relative === "adapters/outbound" || relative.startsWith("adapters/outbound/")) return "outbound";
  if (relative === "composition.go" || relative === "composition") return "composition";
  return undefined;
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

function filesForLayer(moduleDir: string, layer: Layer): string[] {
  if (layer === "composition") return goFiles(moduleDir).filter((file) => path.basename(file) === "composition.go");
  const relative =
    layer === "inbound"
      ? path.join("adapters", "inbound", "http")
      : layer === "outbound"
        ? path.join("adapters", "outbound")
        : layer;
  return goFiles(path.join(moduleDir, relative));
}

function moduleNames(projectDir: string, config: ProjectConfig): string[] {
  const appDir = path.join(projectDir, "internal", "app");
  const discovered = fs.existsSync(appDir)
    ? fs.readdirSync(appDir, { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => entry.name)
    : [];
  return [...new Set([...Object.keys(config.modules), ...discovered])].sort();
}

function expectedFiles(moduleDir: string, module: ModuleConfig): string[] {
  const required = [
    "composition.go",
    "domain/entity.go",
    "domain/errors.go",
    "ports/repository.go",
    "application/dto.go",
    "adapters/inbound/http/dto.go",
    "adapters/inbound/http/handler.go",
    "adapters/outbound/postgres/model.go",
    "adapters/outbound/postgres/repository.go",
  ];
  if (module.applicationStyle === "service") required.push("application/service.go");
  else required.push("application/commands.go", "application/queries.go");
  return required.map((file) => path.join(moduleDir, file));
}

function checkModule(projectDir: string, config: ProjectConfig, name: string, module: ModuleConfig | undefined): string[] {
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

  for (const [layer, patterns] of Object.entries(forbiddenByLayer) as [Exclude<Layer, "composition">, RegExp[]][]) {
    for (const file of filesForLayer(moduleDir, layer)) {
      const content = fs.readFileSync(file, "utf8");
      for (const imported of imports(content)) {
        const rule = patterns.find((pattern) => pattern.test(imported));
        if (rule) errors.push(`${path.relative(projectDir, file)}: ${layer} layer imports forbidden dependency ${imported}`);
        const importedLayer = internalLayer(imported, name);
        if (importedLayer && forbiddenInternalLayers[layer].includes(importedLayer)) {
          errors.push(`${path.relative(projectDir, file)}: ${layer} layer imports forbidden internal layer ${imported}`);
        }
        const other = siblingModule(imported, name);
        if (other) {
          errors.push(`${path.relative(projectDir, file)}: imports sibling module ${other}; use a port and process composition`);
        }
      }
      if (layer === "application" && path.basename(file) === "dto.go" && content.includes("json:")) {
        errors.push(`${path.relative(projectDir, file)}: application DTOs must be transport-neutral; keep JSON tags in adapters/inbound/http/dto.go`);
      }
    }
  }
  for (const file of filesForLayer(moduleDir, "composition")) {
    const content = fs.readFileSync(file, "utf8");
    for (const imported of imports(content)) {
      const other = siblingModule(imported, name);
      if (other) {
        errors.push(`${path.relative(projectDir, file)}: imports sibling module ${other}; use a port and process composition`);
      }
    }
  }
  for (const file of goFiles(moduleDir)) {
    const content = fs.readFileSync(file, "utf8");
    for (const imported of imports(content)) {
      if (/\/internal\/app\/[^/]+\/model(?:\/|$)/.test(imported)) {
        errors.push(`${path.relative(projectDir, file)}: imports a forbidden feature-level model package ${imported}`);
      }
    }
  }
  const rootGoFiles = fs.existsSync(moduleDir)
    ? fs
        .readdirSync(moduleDir, { withFileTypes: true })
        .filter((entry) => entry.isFile() && entry.name.endsWith(".go"))
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
  for (const name of moduleNames(projectDir, config)) errors.push(...checkModule(projectDir, config, name, config.modules[name]));
  if (errors.length) {
    throw new Error(`${pc.red("architecture check failed")}:\n${errors.map((error) => `  - ${error}`).join("\n")}`);
  }
  console.log(pc.green(`architecture check passed: ${moduleNames(projectDir, config).length} split module(s), hexagonal boundary`));
}
