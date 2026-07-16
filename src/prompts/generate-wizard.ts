import { input, select } from "@inquirer/prompts";
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
