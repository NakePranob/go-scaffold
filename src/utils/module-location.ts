import path from "path";
import fs from "fs-extra";
import { ModuleNaming } from "../types";
import { resolveExistingModuleNaming, resolveModuleNaming, toKebabCase } from "./naming";

export function existingModulePackages(projectDir: string): string[] {
  const appDir = path.join(projectDir, "internal", "app");
  if (!fs.existsSync(appDir)) return [];
  return fs
    .readdirSync(appDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name);
}

// A Go package name has no word boundaries: "orderitem" cannot tell you it
// came from "order-items". Everything else a command derives — the model type
// (OrderItem), the route (/order-items), the table (order_items), the
// migration filename — does depend on those boundaries, so re-deriving them
// from the package name yields Orderitem/orderitems and code that doesn't
// compile.
//
// That mattered because the package name is the one form of the name the user
// actually sees: it's the folder on disk, and it's what `generate module`
// prints as the next command to run. Following that instruction produced
// `undefined: model.Orderitem (but have OrderItem)`.
//
// model/model.go is where the boundaries survive — the struct name is
// PascalCase, so kebab-casing it recovers the exact string `generate module`
// was originally given.
function pascalNameOnDisk(projectDir: string, pkg: string): string | null {
  const modelPath = path.join(projectDir, "internal", "app", pkg, "model", "model.go");
  if (!fs.existsSync(modelPath)) return null;
  const match = fs.readFileSync(modelPath, "utf8").match(/^type\s+([A-Z]\w*)\s+struct\b/m);
  return match ? match[1] : null;
}

export function resolveProjectModuleNaming(projectDir: string, rawName: string): ModuleNaming {
  const located = resolveExistingModuleNaming(rawName, existingModulePackages(projectDir));

  const pascal = pascalNameOnDisk(projectDir, located.pkg);
  if (!pascal || pascal === located.pascalName) return located;

  let fromDisk: ModuleNaming;
  try {
    fromDisk = resolveModuleNaming(toKebabCase(pascal));
  } catch {
    return located; // model.go holds something we can't derive a module name from
  }
  // Only trust the correction when it still points at the same package.
  // A hand-renamed struct, or a legacy module whose type never matched its
  // folder, would otherwise silently retarget the command at another module.
  return fromDisk.pkg === located.pkg ? fromDisk : located;
}
