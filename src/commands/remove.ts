import path from "path";
import fs from "fs-extra";
import pc from "picocolors";
import { confirm } from "@inquirer/prompts";
import { readConfig } from "../utils/config";
import { resolveModuleNaming } from "../utils/naming";
import { unpatchMainGo } from "../utils/main-patcher";
import { unpatchOpenapiIndex } from "../utils/openapi-patcher";
import { gofmtTree } from "../utils/template-renderer";
import { promptModuleName } from "../prompts/generate-wizard";

export interface RemoveModuleOptions {
  yes?: boolean;
}

// removeModule is the inverse of generateModule: deletes the domain package and
// pulls its wiring back out of main.go / openapi.yaml / migrations, so dropping
// a domain is one command instead of hand-editing 3+ files (the error-prone
// path that produced the duplicate-registration bug in the first place).
export async function removeModule(
  rawName: string | undefined,
  opts: RemoveModuleOptions,
  projectDir: string = process.cwd()
): Promise<void> {
  const config = readConfig(projectDir);
  const naming = resolveModuleNaming(rawName ?? (await promptModuleName()));
  const modulePath = naming.pkg;

  const moduleDir = path.join(projectDir, "internal", "app", modulePath);
  if (!fs.existsSync(moduleDir)) {
    throw new Error(`module "${naming.pkg}" not found at internal/app/${modulePath} — nothing to remove`);
  }

  if (!opts.yes) {
    const ok = await confirm({
      message: `Remove module "${naming.pkg}"? Deletes internal/app/${modulePath}/, its migration, and un-wires main.go/openapi.yaml`,
      default: false,
    });
    if (!ok) throw new Error("removal cancelled");
  }

  // 1. the domain package
  fs.removeSync(moduleDir);

  // 2. main.go wiring
  unpatchMainGo(path.join(projectDir, "cmd", "api", "main.go"), {
    goModule: config.goModule,
    modulePath,
    pkg: naming.pkg,
    pascalName: naming.pascalName,
  });

  // 3. openapi index + per-module docs
  const openapiPath = path.join(projectDir, "docs", "openapi.yaml");
  if (fs.existsSync(openapiPath)) {
    unpatchOpenapiIndex(openapiPath, naming, config.apiPrefix);
    fs.removeSync(path.join(projectDir, "docs", naming.plural));
  }

  // 4. migration files (up + down)
  const migrationsDir = path.join(projectDir, "migrations");
  const removedMigrations: string[] = [];
  if (fs.existsSync(migrationsDir)) {
    for (const f of fs.readdirSync(migrationsDir)) {
      if (f.endsWith(`_create_${naming.plural}.up.sql`) || f.endsWith(`_create_${naming.plural}.down.sql`)) {
        fs.removeSync(path.join(migrationsDir, f));
        removedMigrations.push(f);
      }
    }
  }

  gofmtTree(projectDir);

  console.log(pc.green(`\nremoved module "${naming.pkg}"`));
  console.log(`  deleted internal/app/${modulePath}/`);
  console.log(`  un-wired cmd/api/main.go`);
  if (fs.existsSync(openapiPath)) console.log(`  un-wired docs/openapi.yaml + deleted docs/${naming.plural}/`);
  if (removedMigrations.length) console.log(`  deleted ${removedMigrations.join(", ")}`);
  console.log(
    pc.yellow(
      `\nnote: the ${naming.plural} table (if migrated) is untouched — drop it yourself, or add a down migration`
    )
  );
}
