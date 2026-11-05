import path from "path";
import fs from "fs-extra";
import {
  HttpPresetError,
  httpConfigFromPreset,
  listPresets,
  presetDirs,
  readPresetFile,
  resolvePreset,
} from "../utils/http-contract";
import { readConfig, writeConfig } from "../utils/config";
import { HttpContractConfig, ResolvedHttpContract } from "../types";

export interface PresetListOptions {
  presetDir?: string;
  json?: boolean;
}

export function listPresetCommand(options: PresetListOptions = {}): void {
  const entries = listPresets(presetDirs(options.presetDir));
  if (options.json) {
    console.log(JSON.stringify({
      presets: entries.map(({ preset, source, builtIn }) => ({
        name: preset.name,
        description: preset.description ?? "",
        http: preset.http,
        source,
        builtIn,
      })),
    }, null, 2));
    return;
  }
  for (const { preset, source } of entries) {
    console.log(`${preset.name}\t${source}\t${preset.description ?? ""}`);
  }
}

export function validatePresetCommand(file: string, json = false): void {
  const preset = readPresetFile(file);
  if (json) {
    console.log(JSON.stringify({ valid: true, preset }, null, 2));
    return;
  }
  console.log(`valid preset: ${preset.name} (${path.resolve(file)})`);
}

function differences(frozen: ResolvedHttpContract, current: ResolvedHttpContract): string[] {
  const changes: string[] = [];
  for (const key of ["single", "list", "error"] as const) {
    if (frozen[key] !== current[key]) changes.push(`${key}: ${frozen[key]} -> ${current[key]}`);
  }
  return changes;
}

export interface PresetDiffOptions {
  presetDir?: string;
  json?: boolean;
  yes?: boolean;
}

export function diffPresetCommand(options: PresetDiffOptions = {}): void {
  const config = readConfig(process.cwd());
  const entry = resolvePreset(config.http.preset, presetDirs(options.presetDir));
  const changes = differences(config.http.resolved, entry.preset.http);
  const output = {
    preset: config.http.preset,
    source: entry.source,
    changed: changes.length > 0,
    differences: changes,
    frozen: config.http.resolved,
    current: entry.preset.http,
  };
  if (options.json) {
    console.log(JSON.stringify(output, null, 2));
    return;
  }
  if (!changes.length) {
    console.log(`preset ${config.http.preset}: no changes`);
    return;
  }
  console.log(`preset ${config.http.preset}:`);
  for (const change of changes) console.log(`  - ${change}`);
}

export function upgradePresetCommand(options: PresetDiffOptions = {}): void {
  const config = readConfig(process.cwd());
  const entry = resolvePreset(config.http.preset, presetDirs(options.presetDir));
  const changes = differences(config.http.resolved, entry.preset.http);
  if (!changes.length) {
    console.log(`preset ${config.http.preset}: already up to date`);
    return;
  }
  console.log(`preset ${config.http.preset}:`);
  for (const change of changes) console.log(`  - ${change}`);
  const generated = ["internal/app", "docs/architect/http-contract.md"].filter((relative) =>
    fs.existsSync(path.join(process.cwd(), relative))
  );
  if (generated.length) {
    console.log("existing generated code is not rewritten; regenerate or migrate these paths:");
    for (const relative of generated) console.log(`  - ${relative}`);
  }
  if (!options.yes) {
    throw new Error("preset upgrade requires --yes; the project config was not changed");
  }
  const http: HttpContractConfig = httpConfigFromPreset(entry.preset);
  writeConfig(process.cwd(), { ...config, http });
  console.log(`updated go-scaffold.config.json to ${http.preset} (${http.presetHash})`);
}

export function isPresetError(error: unknown): error is HttpPresetError {
  return error instanceof HttpPresetError;
}
