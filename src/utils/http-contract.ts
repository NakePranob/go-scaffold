import crypto from "crypto";
import os from "os";
import path from "path";
import fs from "fs-extra";
import {
  ErrorShape,
  HttpContractConfig,
  HttpPresetFile,
  ListShape,
  ResolvedHttpContract,
  SingleShape,
} from "../types";

export const HTTP_PRESET_SCHEMA_VERSION = 1;
export const SINGLE_SHAPES: readonly SingleShape[] = ["bare", "data"];
export const LIST_SHAPES: readonly ListShape[] = [
  "data-limit-offset-total",
  "data-meta",
  "items-total",
];
export const ERROR_SHAPES: readonly ErrorShape[] = [
  "error-object",
  "errors-array",
  "problem-json",
];

export const SHAPE_CATALOG = {
  single: {
    bare: "the resource object",
    data: '{"data": <resource>}',
  },
  list: {
    "data-limit-offset-total": '{"data": [...], "limit": n, "offset": n, "total": n}',
    "data-meta": '{"data": [...], "meta": {"limit": n, "offset": n, "total": n}}',
    "items-total": '{"items": [...], "total": n}',
  },
  error: {
    "error-object": '{"error": {"code": "...", "message": "...", "details"?: ..., "request_id"?: "..."}}',
    "errors-array": '{"errors": [{"code": "...", "message": "..."}]}',
    "problem-json": '{"type": "...", "title": "...", "status": n, "detail": "...", "instance": "..."}',
  },
} as const;

export const BUILT_IN_PRESETS: Record<string, HttpPresetFile> = {
  default: {
    schemaVersion: HTTP_PRESET_SCHEMA_VERSION,
    name: "default",
    description: "Current wire format: bare single resource, data/limit/offset/total list, error object.",
    http: {
      single: "bare",
      list: "data-limit-offset-total",
      error: "error-object",
    },
  },
  envelope: {
    schemaVersion: HTTP_PRESET_SCHEMA_VERSION,
    name: "envelope",
    description: "Every single resource is wrapped in data; lists use data plus a meta object.",
    http: {
      single: "data",
      list: "data-meta",
      error: "error-object",
    },
  },
  items: {
    schemaVersion: HTTP_PRESET_SCHEMA_VERSION,
    name: "items",
    description: "Lists use items/total; errors use an errors array.",
    http: {
      single: "data",
      list: "items-total",
      error: "errors-array",
    },
  },
  problem: {
    schemaVersion: HTTP_PRESET_SCHEMA_VERSION,
    name: "problem",
    description: "Default success shapes with RFC 7807 problem+json errors.",
    http: {
      single: "bare",
      list: "data-limit-offset-total",
      error: "problem-json",
    },
  },
};

export type PresetErrorCode =
  | "INVALID_PRESET"
  | "UNKNOWN_SHAPE"
  | "UNKNOWN_KEY"
  | "DUPLICATE_PRESET"
  | "PRESET_NOT_FOUND";

export class HttpPresetError extends Error {
  constructor(
    public readonly code: PresetErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "HttpPresetError";
  }
}

export interface PresetEntry {
  preset: HttpPresetFile;
  source: string;
  builtIn: boolean;
}

export function defaultPresetDirs(projectDir: string = process.cwd()): string[] {
  return [
    path.join(projectDir, "presets"),
    path.join(os.homedir(), ".config", "go-scaffold", "presets"),
  ];
}

export function presetDirs(explicit: string | undefined, projectDir: string = process.cwd()): string[] {
  return [...new Set([...(explicit ? [path.resolve(explicit)] : []), ...defaultPresetDirs(projectDir)].map((dir) => path.resolve(dir)))];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function assertOneOf<T extends string>(value: unknown, allowed: readonly T[], field: string, file: string): T {
  if (typeof value !== "string" || !allowed.includes(value as T)) {
    throw new HttpPresetError(
      "UNKNOWN_SHAPE",
      `${file}: ${field} must be one of: ${allowed.join(", ")} (got "${String(value)}")`,
    );
  }
  return value as T;
}

export function validatePresetObject(raw: unknown, file = "preset"): HttpPresetFile {
  if (!isRecord(raw)) throw new HttpPresetError("INVALID_PRESET", `${file}: must contain a JSON object`);
  const allowedKeys = new Set(["schemaVersion", "name", "description", "http"]);
  for (const key of Object.keys(raw)) {
    if (!allowedKeys.has(key)) throw new HttpPresetError("UNKNOWN_KEY", `${file}: unknown key "${key}"`);
  }
  if (raw.schemaVersion !== HTTP_PRESET_SCHEMA_VERSION) {
    throw new HttpPresetError(
      "INVALID_PRESET",
      `${file}: schemaVersion must be ${HTTP_PRESET_SCHEMA_VERSION}`,
    );
  }
  if (typeof raw.name !== "string" || !/^[a-z0-9][a-z0-9-]*$/.test(raw.name)) {
    throw new HttpPresetError(
      "INVALID_PRESET",
      `${file}: name must start with a lowercase letter or digit and contain only lowercase letters, digits, and hyphens`,
    );
  }
  if (raw.description !== undefined && typeof raw.description !== "string") {
    throw new HttpPresetError("INVALID_PRESET", `${file}: description must be a string`);
  }
  if (!isRecord(raw.http)) throw new HttpPresetError("INVALID_PRESET", `${file}: http must be an object`);
  const httpKeys = new Set(["single", "list", "error"]);
  for (const key of Object.keys(raw.http)) {
    if (!httpKeys.has(key)) throw new HttpPresetError("UNKNOWN_KEY", `${file}: unknown http key "${key}"`);
  }
  return {
    schemaVersion: HTTP_PRESET_SCHEMA_VERSION,
    name: raw.name,
    ...(raw.description !== undefined ? { description: raw.description } : {}),
    http: {
      single: assertOneOf(raw.http.single, SINGLE_SHAPES, "http.single", file),
      list: assertOneOf(raw.http.list, LIST_SHAPES, "http.list", file),
      error: assertOneOf(raw.http.error, ERROR_SHAPES, "http.error", file),
    },
  };
}

export function readPresetFile(filePath: string): HttpPresetFile {
  const resolved = path.resolve(filePath);
  let raw: unknown;
  try {
    raw = fs.readJsonSync(resolved);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new HttpPresetError("INVALID_PRESET", `${resolved}: ${detail}`);
  }
  return validatePresetObject(raw, resolved);
}

export function loadPresetDir(dir: string): PresetEntry[] {
  if (!fs.existsSync(dir)) return [];
  const entries: PresetEntry[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
    const file = path.join(dir, entry.name);
    entries.push({ preset: readPresetFile(file), source: file, builtIn: false });
  }
  return entries.sort((a, b) => a.preset.name.localeCompare(b.preset.name));
}

export function listPresets(dirs: string[] = defaultPresetDirs()): PresetEntry[] {
  const entries: PresetEntry[] = Object.values(BUILT_IN_PRESETS)
    .slice()
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((preset) => ({ preset, source: "built-in", builtIn: true }));
  const seen = new Set(entries.map((entry) => entry.preset.name));
  for (const dir of dirs) {
    for (const entry of loadPresetDir(dir)) {
      if (seen.has(entry.preset.name)) {
        throw new HttpPresetError(
          "DUPLICATE_PRESET",
          `preset "${entry.preset.name}" is defined more than once (duplicate at ${entry.source})`,
        );
      }
      seen.add(entry.preset.name);
      entries.push(entry);
    }
  }
  return entries;
}

export function resolvePreset(name: string, dirs: string[] = defaultPresetDirs()): PresetEntry {
  const found = listPresets(dirs).find((entry) => entry.preset.name === name);
  if (!found) {
    throw new HttpPresetError(
      "PRESET_NOT_FOUND",
      `preset "${name}" was not found; searched: ${dirs.length ? dirs.join(", ") : "(built-ins only)"}`,
    );
  }
  return found;
}

export function hashResolved(resolved: ResolvedHttpContract): string {
  const canonical = JSON.stringify({
    single: resolved.single,
    list: resolved.list,
    error: resolved.error,
  });
  return `sha256:${crypto.createHash("sha256").update(canonical).digest("hex")}`;
}

export function httpConfigFromPreset(preset: HttpPresetFile): HttpContractConfig {
  return {
    preset: preset.name,
    resolved: preset.http,
    presetHash: hashResolved(preset.http),
  };
}

export function defaultHttpConfig(): HttpContractConfig {
  return httpConfigFromPreset(BUILT_IN_PRESETS.default);
}

export function validateHttpConfig(raw: unknown, file = "go-scaffold.config.json"): HttpContractConfig {
  if (!isRecord(raw)) throw new HttpPresetError("INVALID_PRESET", `${file}: http must be an object`);
  const allowedKeys = new Set(["preset", "resolved", "presetHash"]);
  for (const key of Object.keys(raw)) {
    if (!allowedKeys.has(key)) throw new HttpPresetError("UNKNOWN_KEY", `${file}: unknown http key "${key}"`);
  }
  if (typeof raw.preset !== "string" || !raw.preset) {
    throw new HttpPresetError("INVALID_PRESET", `${file}: http.preset must be a non-empty string`);
  }
  if (!isRecord(raw.resolved)) {
    throw new HttpPresetError("INVALID_PRESET", `${file}: http.resolved must be an object`);
  }
  const resolved: ResolvedHttpContract = {
    single: assertOneOf(raw.resolved.single, SINGLE_SHAPES, "http.resolved.single", file),
    list: assertOneOf(raw.resolved.list, LIST_SHAPES, "http.resolved.list", file),
    error: assertOneOf(raw.resolved.error, ERROR_SHAPES, "http.resolved.error", file),
  };
  const expectedHash = hashResolved(resolved);
  if (typeof raw.presetHash !== "string" || raw.presetHash !== expectedHash) {
    throw new HttpPresetError(
      "INVALID_PRESET",
      `${file}: http.presetHash does not match the resolved shapes (expected ${expectedHash})`,
    );
  }
  return { preset: raw.preset, resolved, presetHash: expectedHash };
}

export function shapeSummary(resolved: ResolvedHttpContract): string {
  return [
    `single: ${SHAPE_CATALOG.single[resolved.single]}`,
    `list: ${SHAPE_CATALOG.list[resolved.list]}`,
    `error: ${SHAPE_CATALOG.error[resolved.error]}`,
  ].join("; ");
}

export function presetChoices(dirs: string[] = defaultPresetDirs()): Array<{
  value: string;
  label: string;
  description: string;
  source: string;
}> {
  return listPresets(dirs).map(({ preset, source }) => ({
    value: preset.name,
    label: preset.name,
    description: preset.description ?? shapeSummary(preset.http),
    source,
  }));
}
