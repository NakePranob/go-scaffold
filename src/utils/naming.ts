import { MethodNaming, ModuleNaming } from "../types";

// ponytail: heuristic pluralizer, not a dependency — covers common English
// nouns (order/user/category/address); irregular plurals still need a manual
// rename in the generated file, add a dictionary if that becomes frequent.
export function pluralize(word: string): string {
  if (/[sxz]$/.test(word) || /[^aeiou](ch|sh)$/.test(word)) return word + "es";
  if (/[^aeiou]y$/.test(word)) return word.slice(0, -1) + "ies";
  if (word.endsWith("s")) return word;
  return word + "s";
}

export function toPascalCase(value: string): string {
  return value
    .replace(/[-_\s]+(.)?/g, (_, char: string) => (char ? char.toUpperCase() : ""))
    .replace(/^(.)/, (char) => char.toUpperCase());
}

// Go package names: lowercase, single word, no separators (effective Go).
export function toPackageName(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9]/g, "");
}

export function toCamelCase(value: string): string {
  const pascal = toPascalCase(value);
  return pascal.charAt(0).toLowerCase() + pascal.slice(1);
}

// URL path segment: "findActive" -> "find-active", "reset_password" -> "reset-password".
export function toKebabCase(value: string): string {
  return value
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .replace(/[_\s]+/g, "-")
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

// Postgres database/identifier name: lowercase snake_case.
export function toDbName(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

// Go module path: each '/'-separated segment is letters/digits, optionally
// with . _ - in the middle — this is what go.mod's `module` line accepts.
// Rejects spaces and other punctuation that would produce a go.mod that
// fails to parse (go: errors parsing go.mod: usage: module module/path).
const VALID_GO_MODULE_PATH = /^[A-Za-z0-9]([A-Za-z0-9._-]*[A-Za-z0-9])?(\/[A-Za-z0-9]([A-Za-z0-9._-]*[A-Za-z0-9])?)*$/;

export function validateGoModulePath(name: string): string | true {
  return VALID_GO_MODULE_PATH.test(name)
    ? true
    : `invalid project name "${name}" — go.mod module paths can't contain spaces; use letters, numbers, ., _, -, / only (e.g. "my-api" or "github.com/org/my-api")`;
}

export function assertValidGoModulePath(name: string): void {
  const result = validateGoModulePath(name);
  if (result !== true) throw new Error(result);
}

export function resolveModuleNaming(rawName: string): ModuleNaming {
  const pkg = toPackageName(rawName);
  if (!pkg) {
    throw new Error(`invalid module name: "${rawName}" (must contain letters/numbers)`);
  }
  return {
    name: pkg,
    pkg,
    pascalName: toPascalCase(pkg),
    plural: pluralize(pkg),
    errorPrefix: pkg.toUpperCase(),
  };
}

export function resolveMethodNaming(rawName: string): MethodNaming {
  const cleaned = rawName.trim();
  const pascalName = toPascalCase(cleaned);
  if (!pascalName) {
    throw new Error(`invalid method name: "${rawName}" (must contain letters/numbers)`);
  }
  return {
    name: cleaned,
    pascalName,
    handlerName: toCamelCase(cleaned),
    pathSegment: toKebabCase(cleaned),
  };
}
