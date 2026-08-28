import { confirm, input, select } from "./interactive";
import { ApplicationStyle, GetMethodMode, MethodType, ModuleProfile, ModuleSurface } from "../types";
import { assertNotGoKeyword, toCamelCase, validateModuleName } from "../utils/naming";
import {
  architectureForModuleProfile,
  describeModuleProfile,
  moduleProfileFor,
  ModuleArchitectureChoice,
  ModuleProfileChoice,
} from "../utils/module-profile";

// wraps an assert-style validator into inquirer's true|string contract so a
// reserved word re-prompts inline instead of aborting the whole command.
function notKeyword(value: string, role: string): true | string {
  try {
    assertNotGoKeyword(toCamelCase(value.trim()), role);
    return true;
  } catch (e) {
    return (e as Error).message;
  }
}

export async function promptModuleName(): Promise<string> {
  const name = await input({
    message: "Module name (singular, e.g. order, product):",
    validate: (value) => (value.trim() ? validateModuleName(value) : "module name is required"),
  });
  return name.trim();
}

export async function promptMethodName(): Promise<string> {
  const name = await input({
    message: "Method name (e.g. approve, findByStatus, resetPassword):",
    validate: (value) => (value.trim() ? notKeyword(value, "method") : "method name is required"),
  });
  return name.trim();
}

export async function promptMethodType(): Promise<MethodType> {
  return select<MethodType>({
    message: "Method type:",
    choices: [
      { name: "GET", value: "get" },
      { name: "POST", value: "post" },
      { name: "PUT", value: "put" },
      { name: "PATCH", value: "patch" },
      { name: "DELETE", value: "delete" },
    ],
  });
}

export async function promptGetMode(): Promise<GetMethodMode> {
  return select<GetMethodMode>({
    message: "GET mode:",
    choices: [
      { name: "List (all) — a new list endpoint with its own filter", value: "all" },
      { name: "Single record lookup (one) — find by a field other than id", value: "one" },
    ],
  });
}

export async function promptMigrationName(): Promise<string> {
  const name = await input({
    message: "Migration name (e.g. add_status_to_orders):",
    validate: (value) => (value.trim() ? true : "migration name is required"),
  });
  return name.trim();
}

export async function promptLookupField(): Promise<string> {
  const field = await input({
    message: "Lookup field (e.g. email, status, slug):",
    validate: (value) => {
      if (!value.trim()) return "field is required";
      if (value.trim().toLowerCase() === "id") return '"id" already has a lookup route — pick another field';
      return notKeyword(value, "lookup field");
    },
  });
  return field.trim();
}

// The `generate module` choices live here next to the other generate prompts so
// the subcommand, bare menu, and project config wizard ask them consistently —
// a choice only reachable by knowing a flag name is not a choice for someone
// driving the CLI interactively.
export async function promptModuleSurface(defaultValue: ModuleSurface = "minimal"): Promise<ModuleSurface> {
  return select<ModuleSurface>({
    message: "What should the module contain?",
    default: defaultValue,
    choices: [
      {
        name: "Minimal — model + wiring only",
        value: "minimal",
        description: "the safe default; add endpoints one at a time with `generate method`",
      },
      {
        name: "CRUD skeleton — list/get/create/update/delete",
        value: "crud",
        description: "all five endpoints wired up; DTO fields and business rules are left as TODO",
      },
    ],
  });
}

export async function promptApplicationStyle(defaultValue: ApplicationStyle = "service"): Promise<ApplicationStyle> {
  return select<ApplicationStyle>({
    message: "How should the application boundary be organised?",
    default: defaultValue,
    choices: [
      {
        name: "Single service",
        value: "service",
        description: "the simpler path; use this unless reads and writes have different business needs",
      },
      {
        name: "CQRS command/query handlers",
        value: "cqrs",
        description: "separate state-changing commands from read-only queries; storage remains shared by default",
      },
    ],
  });
}

/**
 * Ask for the useful decision first. The underlying surface/application
 * choices remain available through Advanced and through the CLI flags, but a
 * new user should not have to understand two architecture axes before making
 * a sensible choice.
 */
export async function promptModuleProfile(defaultValue: ModuleProfileChoice = "lean"): Promise<ModuleProfileChoice> {
  return select<ModuleProfileChoice>({
    message: "Choose a module profile:",
    default: defaultValue,
    choices: [
      {
        name: "Lean — minimal + single service",
        value: "lean",
        description: "model, repository, service and handler wiring; add only the endpoints this domain needs",
      },
      {
        name: "CRUD — CRUD surface + single service",
        value: "crud",
        description: "list/get/create/update/delete skeletons; fields and business rules remain TODOs",
      },
      {
        name: "CQRS — minimal surface + command/query handlers",
        value: "cqrs",
        description: "separate state-changing commands from read-only queries; no broker or second database is added",
      },
      {
        name: "Advanced — choose surface and application boundary",
        value: "advanced",
        description: "for the uncommon CRUD + CQRS combination or a deliberately customised module",
      },
    ],
  });
}

export async function promptAdvancedModuleArchitecture(
  defaultSurface: ModuleSurface = "minimal",
  defaultApplicationStyle: ApplicationStyle = "service"
): Promise<ModuleArchitectureChoice> {
  return {
    moduleSurface: await promptModuleSurface(defaultSurface),
    applicationStyle: await promptApplicationStyle(defaultApplicationStyle),
  };
}

export function moduleArchitectureForProfile(profile: ModuleProfile): ModuleArchitectureChoice {
  return architectureForModuleProfile(profile);
}

export function moduleProfileDescription(
  moduleSurface: ModuleSurface,
  applicationStyle: ApplicationStyle
): string {
  return describeModuleProfile(moduleProfileFor(moduleSurface, applicationStyle));
}

// Backward-compatible boolean helpers for the existing generate-module flow.
// The richer enum prompts are also used by the project config wizard so one
// set of choices describes both the default and the per-module override.
export async function promptModuleShape(defaultValue = false): Promise<boolean> {
  return (await promptModuleSurface(defaultValue ? "crud" : "minimal")) === "crud";
}

export async function promptModuleCqrs(defaultValue = false): Promise<boolean> {
  return (await promptApplicationStyle(defaultValue ? "cqrs" : "service")) === "cqrs";
}

export async function promptModuleAuth(): Promise<boolean> {
  return confirm({
    message: "Require a valid access token for this module's routes?",
    default: false,
  });
}

// Blank is a real answer here (auth without a specific permission), so this
// takes no validate — an unusable code is caught by generateModule, which
// owns the pattern and the "needs add rbac" rule.
export async function promptModulePermission(): Promise<string | undefined> {
  const code = await input({
    message: "Also require a permission code — leave blank for none, or e.g. products:manage:",
  });
  return code.trim() || undefined;
}

// promptExistingModule picks from what's actually on disk, for the commands
// that operate on a module that already exists (`generate method`, `undo
// module`). Free text was the wrong control here: the package name is the one
// form of the name nobody remembers exactly — a typo'd "ordrs" gets
// singularized to "ordr" on the way to the error, so the message names a
// string the user never typed.
export async function promptExistingModule(packages: string[], action: string): Promise<string> {
  if (packages.length === 0) {
    throw new Error(`no modules in internal/app yet — run \`go-scaffold generate module <name>\` before trying to ${action} one`);
  }
  return select({
    message: "Which module?",
    choices: packages.map((pkg) => ({ name: pkg, value: pkg })),
  });
}
