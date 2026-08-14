import path from "path";
import fs from "fs-extra";
import pc from "picocolors";
import { confirm } from "@inquirer/prompts";
import { readConfig } from "../utils/config";
import { resolveProjectModuleNaming } from "../utils/module-location";
import { unpatchMainGo } from "../utils/main-patcher";
import { unpatchOpenapiIndex } from "../utils/openapi-patcher";
import { gofmtTree } from "../utils/template-renderer";
import { promptModuleName } from "../prompts/generate-wizard";

export interface RemoveModuleOptions {
  yes?: boolean;
}

// removeModule deletes application code and reverses generated wiring while
// preserving immutable migration history and table data. Destructive schema
// removal must be an explicit new migration, never a deletion of an applied one.
export async function removeModule(
  rawName: string | undefined,
  opts: RemoveModuleOptions,
  projectDir: string = process.cwd()
): Promise<void> {
  const config = readConfig(projectDir);
  const naming = resolveProjectModuleNaming(projectDir, rawName ?? (await promptModuleName()));
  const modulePath = naming.pkg;

  const moduleDir = path.join(projectDir, "internal", "app", modulePath);
  if (!fs.existsSync(moduleDir)) {
    throw new Error(`module "${naming.pkg}" not found at internal/app/${modulePath} — nothing to remove`);
  }

  if (!opts.yes) {
    const ok = await confirm({
      message:
        `Remove module "${naming.pkg}"? Deletes internal/app/${modulePath}/ and its docs, ` +
        `then un-wires main.go/openapi.yaml. Existing migrations, table, and data are preserved.`,
      default: false,
    });
    if (!ok) throw new Error("removal cancelled");
  }

  // detect --auth/--permission from the generated handler.go itself (not
  // stored anywhere else) — unpatchMainGo needs the exact same flags used at
  // generate-time to reconstruct the identical line it's removing.
  const handlerGoPath = path.join(moduleDir, "handler.go");
  let auth: boolean | undefined;
  let permission: string | undefined;
  if (fs.existsSync(handlerGoPath)) {
    const handlerContent = fs.readFileSync(handlerGoPath, "utf8");
    auth = /jwtSecret\s+string/.test(handlerContent);
    permission = handlerContent.match(/h\.authz\.Require\("([^"]+)"\)/)?.[1];
  }

  // 1. the domain package
  fs.removeSync(moduleDir);

  // 2. main.go wiring
  unpatchMainGo(path.join(projectDir, "cmd", "api", "main.go"), {
    goModule: config.goModule,
    modulePath,
    pkg: naming.pkg,
    pascalName: naming.pascalName,
    auth,
    permission,
  });

  // 3. openapi index + per-module docs
  const openapiPath = path.join(projectDir, "docs", "openapi.yaml");
  if (fs.existsSync(openapiPath)) {
    unpatchOpenapiIndex(openapiPath, naming, config.apiPrefix);
    fs.removeSync(path.join(projectDir, "docs", naming.plural));
  }

  // 4. Migration history is immutable. A migration may already be recorded in
  // schema_migrations on production databases, so deleting its file would make
  // existing and fresh environments disagree and can prevent the app booting.
  // Re-generating the same module reuses this create migration.
  const migrationsDir = path.join(projectDir, "migrations");
  const preservedMigrations = fs.existsSync(migrationsDir)
    ? fs.readdirSync(migrationsDir).filter(
        (f) =>
          f.endsWith(`_create_${naming.plural}.up.sql`) ||
          f.endsWith(`_create_${naming.plural}.down.sql`) ||
          f.endsWith(`_add_${naming.plural}_permission.up.sql`) ||
          f.endsWith(`_add_${naming.plural}_permission.down.sql`)
      )
    : [];

  gofmtTree(projectDir);

  console.log(pc.green(`\nremoved module "${naming.pkg}"`));
  console.log(`  deleted internal/app/${modulePath}/`);
  console.log(`  un-wired cmd/api/main.go`);
  if (fs.existsSync(openapiPath)) console.log(`  un-wired docs/openapi.yaml + deleted docs/${naming.plural}/`);
  if (preservedMigrations.length) {
    console.log(`  preserved migration history: ${preservedMigrations.join(", ")}`);
  }
  console.log(
    pc.yellow(
      `\nnote: the ${naming.tableName} table and its data are untouched. ` +
        `To remove them safely, run \`go-scaffold generate migration drop_${naming.tableName}\` ` +
        `and write an explicit up/down migration.`
    )
  );
}
