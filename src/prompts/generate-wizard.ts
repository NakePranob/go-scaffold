import { input, select } from "@inquirer/prompts";
import { GetMethodMode, MethodType } from "../types";
import { assertNotGoKeyword, toCamelCase, validateModuleName } from "../utils/naming";
import { listVersionFolders, nextVersionName } from "../utils/module-paths";

const NEW_VERSION = "__new__";

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

// promptModuleVersion: for `generate module` in a versioned project. On the
// first module (no version folders yet) there's no real choice to make, so
// it silently returns v1 rather than asking a pointless question. Once
// versions exist, offers to reuse one (the same domain can legitimately live
// in more than one version — that's the point of API versioning) or create a
// new folder (v2, v3, ...), the way nest-scaffold does.
export async function promptModuleVersion(projectDir: string): Promise<string> {
  const versions = listVersionFolders(projectDir);
  if (versions.length === 0) return "v1";

  const choice = await select({
    message: "Which version folder?",
    choices: [
      ...versions.map((v) => ({ name: v, value: v })),
      { name: `Create a new version folder (${nextVersionName(versions)})`, value: NEW_VERSION },
    ],
    default: versions[versions.length - 1],
  });
  if (choice !== NEW_VERSION) return choice;

  const created = await input({
    message: "New version folder name:",
    default: nextVersionName(versions),
    validate: (a) => (/^v\d+$/.test(a.trim()) ? true : "use v<number>, e.g. v2"),
  });
  return created.trim();
}

// promptExistingVersion: for `generate method` / `remove module` when a
// module exists in more than one version folder — pick which one to target.
export async function promptExistingVersion(versions: string[]): Promise<string> {
  return select({
    message: "This module exists in multiple versions — which one?",
    choices: versions.map((v) => ({ name: v, value: v })),
    default: versions[versions.length - 1],
  });
}
