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
// came from "order-items". Everything else a command derives — the entity type
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
// The outbound persistence model is where the generated PascalCase type
// survives, so kebab-casing it recovers the exact string `generate module` was
// originally given.
function pascalNameOnDisk(projectDir: string, pkg: string): string | null {
  // Split hexagonal modules keep persistence models in the outbound adapter.
  // The package name still loses word boundaries (`orderitem`), so recover
  // the original PascalCase entity from the generated `OrderItemModel` type
  // before commands such as `undo module orderitem` rebuild their wiring.
  const adapterModelPath = path.join(
    projectDir,
    "internal",
    "app",
    pkg,
    "adapters",
    "outbound",
    "postgres",
    "model.go",
  );
  if (fs.existsSync(adapterModelPath)) {
    const match = fs.readFileSync(adapterModelPath, "utf8").match(/^type\s+([A-Z]\w*)Model\s+struct\b/m);
    if (match) return match[1];
  }

  return null;
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
  // A hand-renamed struct whose type no longer matches its folder would
  // otherwise silently retarget the command at another module.
  return fromDisk.pkg === located.pkg ? fromDisk : located;
}
