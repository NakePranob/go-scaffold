import { confirm, input, select } from "./interactive";
import { GetMethodMode, MethodType } from "../types";
import { assertNotGoKeyword, toCamelCase, validateModuleName } from "../utils/naming";

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

// The three `generate module` decisions that exist as flags (--full, --auth,
// --permission). They live here next to the other generate prompts so the
// subcommand and the bare-menu path can ask them the same way — a choice only
// reachable by knowing the flag name isn't a choice for anyone driving this
// from the menu.
export async function promptModuleShape(): Promise<boolean> {
  return select<boolean>({
    message: "What should the module contain?",
    default: false,
    choices: [
      {
        name: "Minimal — model + wiring only",
        value: false,
        description: "the safe default; add endpoints one at a time with `generate method`",
      },
      {
        name: "CRUD skeleton — list/get/create/update/delete",
        value: true,
        description: "all five endpoints wired up; DTO fields and business rules are left as TODO",
      },
    ],
  });
}

export async function promptModuleCqrs(): Promise<boolean> {
  return confirm({
    message: "Split application commands and queries for this module?",
    default: false,
  });
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
