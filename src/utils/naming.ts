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

// Go's 25 reserved words — a package/func/param named any of these produces
// code that won't parse (`package func`, `func (h *Handler) type(...)`).
const GO_KEYWORDS = new Set([
  "break", "case", "chan", "const", "continue", "default", "defer", "else",
  "fallthrough", "for", "func", "go", "goto", "if", "import", "interface",
  "map", "package", "range", "return", "select", "struct", "switch", "type", "var",
]);

// predeclared type names — legal as identifiers, but a *package* named one of
// these shadows the builtin in generated code that uses it as a type (main.go
// has `s string`), so reject them for module names specifically.
const GO_PREDECLARED_TYPES = new Set([
  "any", "bool", "byte", "comparable", "complex64", "complex128", "error",
  "float32", "float64", "int", "int8", "int16", "int32", "int64", "rune",
  "string", "uint", "uint8", "uint16", "uint32", "uint64", "uintptr",
]);

// method/handler/param identifier: only keywords are hard-illegal (a param or
// func named `string` is legal Go, just shadows the builtin locally).
export function assertNotGoKeyword(ident: string, role: string): void {
  if (GO_KEYWORDS.has(ident.toLowerCase())) {
    throw new Error(`"${ident}" is a Go keyword — can't use it as a ${role} name; pick another`);
  }
}

// module name becomes a Go package name; keywords and predeclared type names
// both produce code that won't compile (`package func`, or a `string` package
// shadowing the builtin in main.go). Returns true|message for inquirer, and
// backs the assert in resolveModuleNaming — one source of truth for both.
export function validateModuleName(rawName: string): string | true {
  const pkg = toPackageName(rawName);
  if (!pkg) return `invalid module name: "${rawName}" (must contain letters/numbers)`;
  if (/^[0-9]/.test(pkg)) {
    return `"${pkg}" starts with a digit — a Go package name can't, so it won't compile; pick another module name`;
  }
  if (GO_KEYWORDS.has(pkg) || GO_PREDECLARED_TYPES.has(pkg)) {
    return `"${pkg}" is a reserved Go word — a package named it won't compile; pick another module name`;
  }
  return true;
}

// apiPrefix becomes both a URL path segment (/v1/orders) and a Go identifier
// (the `api := r.Group("/v1")` variable is always named "api", so the prefix
// itself never needs to be a valid Go identifier — just a clean URL segment).
// Empty string is valid on purpose: it means "no prefix", routes register
// directly at /orders.
export function validateApiPrefix(raw: string): string | true {
  const trimmed = raw.trim();
  if (trimmed === "") return true;
  return /^[a-z][a-z0-9]*$/.test(trimmed)
    ? true
    : `invalid API prefix "${trimmed}" — use lowercase letters/numbers only, starting with a letter (e.g. "v1", "api"), or leave blank for none`;
}

export function resolveModuleNaming(rawName: string): ModuleNaming {
  const check = validateModuleName(rawName);
  if (check !== true) throw new Error(check);
  const pkg = toPackageName(rawName);
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
  // handlerName becomes a Go method name (`func (h *Handler) <name>`)
  assertNotGoKeyword(toCamelCase(cleaned), "method");
  return {
    name: cleaned,
    pascalName,
    handlerName: toCamelCase(cleaned),
    pathSegment: toKebabCase(cleaned),
  };
}
