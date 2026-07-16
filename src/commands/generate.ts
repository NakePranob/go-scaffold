import path from "path";
import fs from "fs-extra";
import pc from "picocolors";
import { readConfig } from "../utils/config";
import { resolveModuleNaming, toDbName } from "../utils/naming";
import { applyTemplateEntries, gofmtTree } from "../utils/template-renderer";
import { MODULE_FILES, MODULE_FILES_MINIMAL } from "../templates/module-manifest";
import { patchMainGo } from "../utils/main-patcher";
import { patchOpenapiIndex } from "../utils/openapi-patcher";
import { nextMigrationSeq } from "../utils/migrations";
import { promptModuleName } from "../prompts/generate-wizard";

export interface GenerateModuleOptions {
  full?: boolean;
}

export async function generateModule(
  rawName: string | undefined,
  opts: GenerateModuleOptions,
  projectDir: string = process.cwd()
): Promise<void> {
  const config = readConfig(projectDir);
  const naming = resolveModuleNaming(rawName ?? (await promptModuleName()));
  const modulePath = naming.pkg;

  const moduleDir = path.join(projectDir, "internal", "app", modulePath);
  if (fs.existsSync(moduleDir) && fs.readdirSync(moduleDir).length > 0) {
    throw new Error(`${moduleDir} already exists — pick a different name or delete it first`);
  }

  const context = {
    ...naming,
    goModule: config.goModule,
    dbName: toDbName(config.projectName),
    modulePath,
  };

  const moduleFiles = opts.full ? MODULE_FILES : MODULE_FILES_MINIMAL;
  const moduleEntries = moduleFiles.map((f) => ({
    template: f.template,
    output: path.join("internal", "app", modulePath, f.output),
  }));
  await applyTemplateEntries(projectDir, moduleEntries, context);

  // skip if a create_<plural> migration already exists — re-running after
  // only the module folder was deleted shouldn't leave a duplicate migration.
  const migrationsDir = path.join(projectDir, "migrations");
  const migrationExists =
    fs.existsSync(migrationsDir) &&
    fs.readdirSync(migrationsDir).some((f) => f.endsWith(`_create_${naming.plural}.up.sql`));
  let seq = "";
  if (!migrationExists) {
    seq = nextMigrationSeq(migrationsDir);
    const migrationEntries = [
      {
        template: "generate/module/migration.up.sql.hbs",
        output: path.join("migrations", `${seq}_create_${naming.plural}.up.sql`),
      },
      {
        template: "generate/module/migration.down.sql.hbs",
        output: path.join("migrations", `${seq}_create_${naming.plural}.down.sql`),
      },
    ];
    await applyTemplateEntries(projectDir, migrationEntries, context);
  }

  const mainGoPath = path.join(projectDir, "cmd", "api", "main.go");
  patchMainGo(mainGoPath, {
    goModule: config.goModule,
    modulePath,
    pkg: naming.pkg,
    pascalName: naming.pascalName,
  });

  let docsMessage = "";
  const openapiPath = path.join(projectDir, "docs", "openapi.yaml");
  if (opts.full && config.features.openapiDocs && fs.existsSync(openapiPath)) {
    const docsEntries = [
      { template: "generate/module/docs/collection.yaml.hbs", output: path.join("docs", naming.plural, "collection.yaml") },
      { template: "generate/module/docs/item.yaml.hbs", output: path.join("docs", naming.plural, "item.yaml") },
      { template: "generate/module/docs/schemas.yaml.hbs", output: path.join("docs", naming.plural, "schemas.yaml") },
    ];
    await applyTemplateEntries(projectDir, docsEntries, context);
    patchOpenapiIndex(openapiPath, naming, config.apiPrefix);
    docsMessage = `\ndocs: docs/${naming.plural}/{collection,item,schemas}.yaml, wired into docs/openapi.yaml`;
  }

  gofmtTree(projectDir);

  const routePath = config.apiPrefix ? `/${config.apiPrefix}/${naming.plural}` : `/${naming.plural}`;
  console.log(pc.green(`\ngenerated internal/app/${modulePath}/`));
  if (opts.full) {
    console.log(`registered route ${routePath} in cmd/api/main.go`);
  } else {
    console.log(
      `registered empty route group ${routePath} in cmd/api/main.go — ` +
        `add endpoints with \`go-scaffold generate method ${naming.pkg} <name> --type ...\``
    );
  }
  if (seq) {
    console.log(`migration: migrations/${seq}_create_${naming.plural}.{up,down}.sql`);
  } else {
    console.log(`migration: reused existing migrations/*_create_${naming.plural}.{up,down}.sql`);
  }
  if (docsMessage) console.log(docsMessage);
  console.log(
    pc.dim(
      `\nnext: add real fields to model.go/dto.go, run \`go build ./...\`, then apply the migration ` +
        `(AUTO_MIGRATE=true handles it in dev, or \`migrate -path migrations -database "$DB_DSN" up\`)`
    )
  );
}
