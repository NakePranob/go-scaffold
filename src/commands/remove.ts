import path from "path";
import fs from "fs-extra";
import pc from "picocolors";
import { confirm } from "@inquirer/prompts";
import { readConfig } from "../utils/config";
import { resolveModuleNaming } from "../utils/naming";
import { unpatchMainGo } from "../utils/main-patcher";
import { docsFolderName, unpatchOpenapiIndex } from "../utils/openapi-patcher";
import { gofmtTree } from "../utils/template-renderer";
import { promptExistingVersion, promptModuleName } from "../prompts/generate-wizard";
import { versionsContainingModule } from "../utils/module-paths";

export interface RemoveModuleOptions {
  moduleVersion?: string;
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

  let modulePath = naming.pkg;
  let version: string | undefined;
  if (config.features.versioning) {
    if (opts.moduleVersion) {
      version = opts.moduleVersion;
      if (!/^[a-z][a-z0-9]*$/.test(version)) {
        throw new Error(`invalid --module-version "${version}" — expected a bare identifier like v1, v2`);
      }
    } else {
      const matches = versionsContainingModule(projectDir, naming.pkg);
      version = matches.length > 1 ? await promptExistingVersion(matches) : matches[0] ?? "v1";
    }
    modulePath = `${version}/${naming.pkg}`;
  } else if (opts.moduleVersion) {
    throw new Error(
      "--module-version was passed but this project doesn't have versioning enabled (see go-scaffold.config.json)"
    );
  }

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

  // versions of this SAME module other than the one being removed — if any
  // remain, they still need the migration (same table, different API shape),
  // so step 4 below must not delete it out from under them.
  const otherVersions = versionsContainingModule(projectDir, naming.pkg).filter((v) => v !== version);

  // 1. the domain package
  fs.removeSync(moduleDir);

  // 2. main.go wiring
  unpatchMainGo(path.join(projectDir, "cmd", "api", "main.go"), {
    goModule: config.goModule,
    modulePath,
    pkg: naming.pkg,
    pascalName: naming.pascalName,
    version,
  });

  // 3. openapi index + per-module docs
  const openapiPath = path.join(projectDir, "docs", "openapi.yaml");
  const docsFolder = docsFolderName(naming, version);
  if (fs.existsSync(openapiPath)) {
    unpatchOpenapiIndex(openapiPath, naming, version);
    fs.removeSync(path.join(projectDir, "docs", docsFolder));
  }

  // 4. migration files (up + down) — skip if another version still shares them
  const migrationsDir = path.join(projectDir, "migrations");
  const removedMigrations: string[] = [];
  if (fs.existsSync(migrationsDir) && otherVersions.length === 0) {
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
  if (fs.existsSync(openapiPath)) console.log(`  un-wired docs/openapi.yaml + deleted docs/${docsFolder}/`);
  if (removedMigrations.length) console.log(`  deleted ${removedMigrations.join(", ")}`);
  else if (otherVersions.length) {
    console.log(pc.dim(`  kept the migration — still used by ${otherVersions.join(", ")}`));
  }
  console.log(
    pc.yellow(
      `\nnote: the ${naming.plural} table (if migrated) is untouched — drop it yourself, or add a down migration`
    )
  );
}
