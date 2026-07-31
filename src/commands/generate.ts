import path from "path";
import fs from "fs-extra";
import pc from "picocolors";
import { readConfig } from "../utils/config";
import { resolveModuleNaming, toDbName } from "../utils/naming";
import { applyTemplateEntries, gofmtTree } from "../utils/template-renderer";
import { MODULE_FILES, MODULE_FILES_MINIMAL } from "../templates/module-manifest";
import { patchMainGo } from "../utils/main-patcher";
import { patchOpenapiIndex } from "../utils/openapi-patcher";
import { newMigrationVersion } from "../utils/migrations";
import { assertNoDrift, typeChecks } from "../utils/gocheck";
import { promptModuleName } from "../prompts/generate-wizard";

export interface GenerateModuleOptions {
  full?: boolean;
  auth?: boolean;
  permission?: string;
}

const PERMISSION_CODE_PATTERN = /^[a-z][a-z0-9:_-]*$/;

export async function generateModule(
  rawName: string | undefined,
  opts: GenerateModuleOptions,
  projectDir: string = process.cwd()
): Promise<void> {
  const config = readConfig(projectDir);

  // --permission implies --auth (authz.Require must run after RequireAuth) —
  // require both explicitly rather than silently turning one on, so the
  // generated route's protection matches what the command line actually said.
  if (opts.permission && !opts.auth) {
    throw new Error("--permission requires --auth (permission checks run after auth) — pass both, e.g. --auth --permission products:manage");
  }
  if (opts.auth && !config.features.auth) {
    throw new Error("--auth requires `go-scaffold add auth` first — there's no RequireAuth middleware yet");
  }
  if (opts.permission) {
    if (!config.features.rbac) {
      throw new Error("--permission requires `go-scaffold add rbac` first — there's no permissions table or authz middleware yet");
    }
    if (!PERMISSION_CODE_PATTERN.test(opts.permission)) {
      throw new Error(`invalid permission code "${opts.permission}" — must start with a lowercase letter and contain only lowercase letters, digits, ':', '_', or '-'`);
    }
  }

  const naming = resolveModuleNaming(rawName ?? (await promptModuleName()));
  const modulePath = naming.pkg;

  const moduleDir = path.join(projectDir, "internal", "app", modulePath);
  if (fs.existsSync(moduleDir) && fs.readdirSync(moduleDir).length > 0) {
    throw new Error(`${moduleDir} already exists — pick a different name or delete it first`);
  }

  // snapshot before writing anything, so assertNoDrift below can tell "we broke
  // it" from "it was already broken"
  const checkBefore = typeChecks(projectDir);

  const context = {
    ...naming,
    goModule: config.goModule,
    dbName: toDbName(config.projectName),
    modulePath,
    auth: opts.auth,
    permission: opts.permission,
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
    seq = newMigrationVersion(migrationsDir);
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

  // --permission needs the code to actually exist before any role can be
  // granted it — SetPermissions validates against the real catalog and
  // rejects unknown codes, so an ungenerated permission would leave the
  // route permanently unreachable by anyone, admin included.
  let permissionSeq = "";
  if (opts.permission) {
    permissionSeq = newMigrationVersion(migrationsDir);
    const permissionEntries = [
      {
        template: "generate/module/permission.up.sql.hbs",
        output: path.join("migrations", `${permissionSeq}_add_${naming.plural}_permission.up.sql`),
      },
      {
        template: "generate/module/permission.down.sql.hbs",
        output: path.join("migrations", `${permissionSeq}_add_${naming.plural}_permission.down.sql`),
      },
    ];
    await applyTemplateEntries(projectDir, permissionEntries, context);
  }

  const mainGoPath = path.join(projectDir, "cmd", "api", "main.go");
  patchMainGo(mainGoPath, {
    goModule: config.goModule,
    modulePath,
    pkg: naming.pkg,
    pascalName: naming.pascalName,
    auth: opts.auth,
    permission: opts.permission,
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
  assertNoDrift(projectDir, checkBefore, config);

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
  if (opts.permission) {
    console.log(`protected: requires a valid access token AND the "${opts.permission}" permission`);
  } else if (opts.auth) {
    console.log("protected: requires a valid access token (no specific permission)");
  } else if (config.features.auth) {
    console.log(
      pc.yellow(`note: this project has auth installed, but ${routePath} is PUBLIC — re-run with --auth (and --permission <code> if you also have rbac) to require login`)
    );
  }
  if (seq) {
    console.log(`migration: migrations/${seq}_create_${naming.plural}.{up,down}.sql`);
  } else {
    console.log(`migration: reused existing migrations/*_create_${naming.plural}.{up,down}.sql`);
  }
  if (permissionSeq) {
    console.log(`migration: migrations/${permissionSeq}_add_${naming.plural}_permission.{up,down}.sql (seeds the "${opts.permission}" permission — grant it to a role via PATCH /roles/:code/permissions)`);
  }
  if (docsMessage) console.log(docsMessage);
  console.log(
    pc.dim(
      `\nnext: add real fields to model.go/dto.go, run \`go build ./...\`, then apply the migration ` +
        `(AUTO_MIGRATE=true handles it in dev, or \`migrate -path migrations -database "$DB_DSN" up\`)`
    )
  );
}
