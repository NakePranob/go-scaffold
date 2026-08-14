import path from "path";
import fs from "fs-extra";
import { ModuleNaming } from "../types";
import { resolveExistingModuleNaming } from "./naming";

export function existingModulePackages(projectDir: string): string[] {
  const appDir = path.join(projectDir, "internal", "app");
  if (!fs.existsSync(appDir)) return [];
  return fs
    .readdirSync(appDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name);
}

export function resolveProjectModuleNaming(projectDir: string, rawName: string): ModuleNaming {
  return resolveExistingModuleNaming(rawName, existingModulePackages(projectDir));
}
