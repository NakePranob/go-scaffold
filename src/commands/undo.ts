import path from "path";
import { execFileSync, spawnSync } from "child_process";
import fs from "fs-extra";
import pc from "picocolors";
import { confirm } from "../prompts/interactive";
import { readConfig, writeConfig } from "../utils/config";
import { migrationSlugAliases } from "../utils/naming";
import { ModuleNaming } from "../types";
import { existingModulePackages, resolveProjectModuleNaming } from "../utils/module-location";
import { unpatchMainGo } from "../utils/main-patcher";
import { unpatchOpenapiIndex } from "../utils/openapi-patcher";
import { unpatchGolangciForModule } from "../utils/golangci-patcher";
import { gofmtTree } from "../utils/template-renderer";
import { assertNoDrift, typeChecks } from "../utils/gocheck";
import { promptExistingModule } from "../prompts/generate-wizard";

export interface UndoModuleOptions {
  yes?: boolean;
}

// undoModule reverses a `generate module` that shouldn't have happened —
// a typo'd name, a domain you decided against — by deleting everything it
// created, migration files included.
//
// It deliberately does NOT try to retire a domain that is live somewhere.
// The command this replaced claimed to ("a migration may already be recorded
// in schema_migrations on production"), and that framing was wrong twice
// over. Nobody decommissions a shipped domain by running a scaffolding CLI:
// that needs a deprecation window, a data migration, and a drop migration
// written by hand. Meanwhile the case people actually hit — undoing a module
// generated thirty seconds ago — got the production treatment, so the typo's
// migration survived forever. `migrations/embed.go` is a `//go:embed *`, so
// that leftover then ran on every database anyone created from then on,
// building a `oder_svc.oders` table nobody asked for.
//
// So: work out whether the migration could possibly have escaped this
// machine. If it can't have, delete it. If it might have, refuse and say why.
export async function undoModule(
  rawName: string | undefined,
  opts: UndoModuleOptions,
  projectDir: string = process.cwd()
): Promise<void> {
  const config = readConfig(projectDir);
  const naming = resolveProjectModuleNaming(projectDir, rawName ?? (await promptExistingModule(existingModulePackages(projectDir), "undo")));
  const modulePath = naming.pkg;

  const moduleDir = path.join(projectDir, "internal", "app", modulePath);
  if (!fs.existsSync(moduleDir)) {
    throw new Error(`module "${naming.pkg}" not found at internal/app/${modulePath} — nothing to undo`);
  }

  // `user` and `role` live under internal/app/ like any generated module, but
  // they were wired by add auth / add rbac using entirely different line
  // shapes — this command would delete the package and then silently fail to
  // un-wire most of it, leaving main.go and cmd/seed referencing a package
  // that no longer exists. findDependents can't catch it either: the
  // consumer-side-interface convention means `user` never imports `role`.
  const featureOwner: Record<string, "auth" | "rbac"> = { user: "auth", role: "rbac" };
  const owner = featureOwner[modulePath];
  if (owner && config.features[owner]) {
    throw new Error(
      `"${modulePath}" belongs to \`go-scaffold add ${owner}\`, not to \`generate module\` — refusing to undo it.\n` +
        `Its wiring in cmd/api/wiring.go (and cmd/seed, docs/openapi.yaml) doesn't match what this command knows how to reverse,\n` +
        `so removing it would leave the project un-compilable. Undo \`add ${owner}\` by hand, or start from a fresh scaffold.`
    );
  }

  const migrationsDir = path.join(projectDir, "migrations");
  const { owned: migrations, unclaimed } = moduleMigrations(migrationsDir, naming);
  const { checkedDatabase } = assertMigrationsNeverEscaped(projectDir, migrations, naming.pkg);

  if (!opts.yes) {
    const ok = await confirm({
      message:
        `Undo module "${naming.pkg}"? Deletes internal/app/${modulePath}/, its docs, ` +
        `${migrations.length ? `${migrations.length} migration file(s), ` : ""}` +
        `and un-wires wiring.go/openapi.yaml. The ${naming.tableName} table itself is not dropped.`,
      default: false,
    });
    if (!ok) throw new Error("undo cancelled");
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

  // Refuse if another domain still imports this one. Deleting it anyway
  // leaves the project un-compilable, and the error Go reports then points at
  // the surviving module rather than at the removal that caused it.
  const dependents = findDependents(projectDir, config.goModule, modulePath);
  if (dependents.length > 0) {
    throw new Error(
      `module "${naming.pkg}" is still used by: ${dependents.join(", ")}\n` +
        `remove those references (or the modules themselves) first — deleting internal/app/${modulePath} now would break the build`
    );
  }

  const before = typeChecks(projectDir);

  // Un-wire before deleting, not after. Every step below can throw — a
  // hand-edited wiring.go with the routes marker gone is enough — and if the
  // package is already gone by then, the user's own code inside it is
  // unrecoverable outside of git. This order fails the other way round: a
  // still-present package with its wiring removed, which `generate module`
  // re-wires idempotently.

  // 1. wiring.go
  unpatchMainGo(path.join(projectDir, "cmd", "api", "wiring.go"), {
    goModule: config.goModule,
    modulePath,
    pkg: naming.pkg,
    pascalName: naming.pascalName,
    schemaName: naming.schemaName,
    auth,
    permission,
  });

  unpatchGolangciForModule(path.join(projectDir, ".golangci.yml"), modulePath);

  // 2. openapi index + per-module docs
  const openapiPath = path.join(projectDir, "docs", "openapi.yaml");
  if (fs.existsSync(openapiPath)) {
    unpatchOpenapiIndex(openapiPath, naming, config.apiPrefix);
    fs.removeSync(path.join(projectDir, "docs", naming.plural));
  }

  // 3. the migrations — safe to delete, assertMigrationsNeverEscaped proved
  // above that they exist nowhere but this working tree
  for (const file of migrations) fs.removeSync(path.join(migrationsDir, file));

  // 4. the domain package — last, once nothing left can fail
  fs.removeSync(moduleDir);

  gofmtTree(projectDir);
  assertNoDrift(projectDir, before, config, {
    didWhat: `undid module "${naming.pkg}"`,
    recover: `internal/app/${modulePath}/ is gone; re-run \`go-scaffold generate module ${naming.pkg}\` to put it\nback, then reconcile cmd/api/wiring.go by hand.`,
  });

  if (config.modules[modulePath]) {
    const modules = { ...config.modules };
    delete modules[modulePath];
    writeConfig(projectDir, { ...config, modules });
  }

  console.log(pc.green(`\nundid module "${naming.pkg}"`));
  console.log(`  deleted internal/app/${modulePath}/`);
  console.log(`  un-wired cmd/api/wiring.go`);
  if (fs.existsSync(openapiPath)) console.log(`  un-wired docs/openapi.yaml + deleted docs/${naming.plural}/`);
  if (migrations.length) console.log(`  deleted migrations/${migrations.join(", migrations/")}`);
  if (migrations.length && !checkedDatabase) {
    console.log(
      pc.yellow(
        `\ncouldn't check whether those migrations had already been applied — no reachable DB_DSN,\n` +
          `or no migrate CLI. They weren't committed, so no other environment can have them, but if\n` +
          `you had run them against a local database it now records a version with no file behind it.`
      )
    );
  }
  if (unclaimed.length) {
    console.log(
      pc.yellow(
        `\nleft in place: ${unclaimed.join(", ")}\n` +
          `  named like this module's column migrations but not referencing ${naming.schemaName}.${naming.tableName},\n` +
          `  so they look like they belong to another table. Delete them by hand if they don't.`
      )
    );
  }
  console.log(
    pc.dim(
      `\nnothing was dropped from any database — if you had already run these migrations locally,\n` +
        `the ${naming.tableName} table is still there. \`make db-drop && make db-create && make migrate-up\` is the\n` +
        `quickest way back to a clean dev database.`
    )
  );
}

// moduleMigrations lists every migration file this module caused: the create
// pair, the permission pair from --permission, and the column pair that
// `generate method --get-mode one --field <f>` writes (method.ts names it
// `<version>_add_<tableName>_<column>`).
//
// That last one used to be left behind. The module and its create migration
// went, the ALTER TABLE against the now-uncreated table stayed, and because
// migrations/embed.go is a `//go:embed *` it then ran on every database made
// from that project — "schema <x>_svc does not exist" — which is the exact
// failure this command exists to prevent.
//
// The column pair cannot be claimed on filename alone: a module whose table is
// `orders` would otherwise also claim `_add_orders_logs_email.up.sql`, which
// belongs to a table named `orders_logs`. So a filename match is confirmed
// against the file's own `<schema>.<table>` reference, which is unique to this
// module. Anything that matches the shape but not the schema is reported
// rather than silently deleted or silently kept.
function moduleMigrations(
  migrationsDir: string,
  naming: ModuleNaming
): { owned: string[]; unclaimed: string[] } {
  if (!fs.existsSync(migrationsDir)) return { owned: [], unclaimed: [] };

  const slugs = migrationSlugAliases(naming);
  const owned: string[] = [];
  const unclaimed: string[] = [];

  for (const f of fs.readdirSync(migrationsDir).sort()) {
    const suffix = [".up.sql", ".down.sql"].find((e) => f.endsWith(e));
    if (!suffix) continue;
    const stem = f.slice(0, -suffix.length);

    if (slugs.some((slug) => stem.endsWith(`_create_${slug}`) || stem.endsWith(`_add_${slug}_permission`))) {
      owned.push(f);
      continue;
    }
    // `<version>_add_<slug>_<column>` — the --field column migration
    if (!slugs.some((slug) => new RegExp(`^\\d+_add_${slug}_.+$`).test(stem))) continue;
    if (fs.readFileSync(path.join(migrationsDir, f), "utf8").includes(`${naming.schemaName}.${naming.tableName}`)) {
      owned.push(f);
    } else {
      unclaimed.push(f);
    }
  }
  return { owned, unclaimed };
}

// assertMigrationsNeverEscaped is what lets undo delete migration files at
// all. A migration that has only ever existed in this working tree cannot be
// recorded in any other environment's schema_migrations, so removing it can't
// make two databases disagree. Two ways it could have escaped:
//
//   1. it's committed — then it's in whatever anyone pulled or deployed
//   2. it's applied to the database this project is pointed at
//
// A project with no git repository at all has never been pushed anywhere, so
// "git doesn't know this file" covers it.
//
// The git half is the one that has to be right: it's what decides whether a
// migration could be in someone else's database. The database half only ever
// protects the developer's own dev database, and that damage is recoverable
// (`migrate force`), so an unreachable database doesn't block the command —
// it reports back that it couldn't check, and the caller says so.
function assertMigrationsNeverEscaped(
  projectDir: string,
  migrations: string[],
  pkg: string
): { checkedDatabase: boolean } {
  if (migrations.length === 0) return { checkedDatabase: true };

  const known = migrations.filter((f) => gitKnowsAbout(projectDir, path.join("migrations", f)));
  if (known.length) {
    throw new Error(
      `git knows about these migrations, so they may already have been applied somewhere:\n` +
        known.map((f) => `  migrations/${f}`).join("\n") +
        `\n\n\`undo\` is for a module you generated and immediately regretted — it deletes migration\n` +
        `files, which is only safe while they exist nowhere but this working tree. To retire a domain\n` +
        `that has shipped, leave its history alone and write the reversal explicitly:\n` +
        `  go-scaffold generate migration drop_${pkg}`
    );
  }

  // Check every database this project could mean, not just the first one
  // found: an exported DB_DSN left over in the shell would otherwise shadow
  // the project's own .env and answer for the wrong database entirely.
  let checkedDatabase = true;
  for (const dsn of candidateDsns(projectDir)) {
    const applied = appliedVersion(projectDir, dsn);
    if (applied === null) {
      checkedDatabase = false;
      continue;
    }
    const escaped = migrations.filter((f) => Number(f.split("_")[0]) <= applied);
    if (escaped.length) {
      throw new Error(
        `these migrations have already been applied to your database (schema_migrations is at ${applied}):\n` +
          escaped.map((f) => `  migrations/${f}`).join("\n") +
          `\n\nDeleting the files now would leave the database recorded at a version with no migration\n` +
          `behind it, and golang-migrate would refuse to move from there. Roll them back first:\n` +
          `  migrate -path migrations -database "$DB_DSN" down ${escaped.length / 2 || 1}\n` +
          `then run this again.`
      );
    }
  }
  return { checkedDatabase };
}

// gitKnowsAbout asks both questions, because either one means the file has
// left this working tree. The index alone isn't enough: a file that was
// committed and later `git rm --cached`'d is untracked now but is still in
// history, and in anything anyone has pulled.
function gitKnowsAbout(projectDir: string, relativePath: string): boolean {
  if (runsClean(projectDir, ["ls-files", "--error-unmatch", relativePath])) return true;
  const inHistory = spawnSync("git", ["log", "--all", "--max-count=1", "--format=%H", "--", relativePath], {
    cwd: projectDir,
    encoding: "utf8",
  });
  return !inHistory.error && inHistory.status === 0 && inHistory.stdout.trim() !== "";
}

function runsClean(projectDir: string, args: string[]): boolean {
  try {
    execFileSync("git", args, { cwd: projectDir, stdio: "ignore" });
    return true;
  } catch {
    // not tracked, or not a git repository at all
    return false;
  }
}

// appliedVersion reads schema_migrations through the migrate CLI the project
// already documents. Returns null when it can't tell — no migrate on PATH, no
// DB_DSN, database unreachable, or nothing applied yet.
function appliedVersion(projectDir: string, dsn: string): number | null {
  // spawnSync, not execFileSync: `migrate version` prints the version on
  // stderr and still exits 0, and execFileSync only hands back stdout. That
  // read as "" -> Number("") -> 0 -> "nothing applied yet", which waved every
  // migration straight through the check this function exists to perform.
  //
  // The timeout matters as much: a DSN pointing at an unroutable host makes
  // migrate sit on the OS TCP timeout, and the CLI froze for 77 seconds with
  // no output before carrying on anyway.
  const res = spawnSync("migrate", ["-path", "migrations", "-database", dsn, "version"], {
    cwd: projectDir,
    encoding: "utf8",
    timeout: 5000,
  });
  if (res.error) return null; // no migrate on PATH, or it timed out
  const output = `${res.stderr ?? ""}\n${res.stdout ?? ""}`;
  // a database that has never been migrated is a definitive "nothing
  // applied", not an inconclusive answer
  if (/no migration/i.test(output)) return 0;
  return parseVersion(output);
}

// parseVersion pulls the bare version number out of migrate's output, and
// insists on actually finding one: anything else (a connection error, a
// "dirty" marker, an empty string) has to read as "can't tell", never as 0.
function parseVersion(output: string): number | null {
  const match = output.trim().match(/^(\d+)/m);
  return match ? Number(match[1]) : null;
}

// dsnFromEnvFile reads DB_DSN out of .env the same way the generated Makefile
// does, and tolerates the two spellings people actually write: a quoted value,
// and a leading `export`. Getting either wrong doesn't fail loudly — it hands
// `migrate` a DSN it can't parse, appliedVersion then reports "can't tell",
// and the applied-migrations guard is skipped entirely. Both forms silently
// defeated it.
// candidateDsns returns every database this project might mean, deduped. Both
// are checked rather than just the first: an exported DB_DSN pointing at some
// other environment would otherwise shadow the project's own .env and answer
// the applied-migrations question about the wrong database.
function candidateDsns(projectDir: string): string[] {
  const found = [process.env.DB_DSN, dsnFromEnvFile(projectDir)].filter((d): d is string => Boolean(d));
  return [...new Set(found)];
}

function dsnFromEnvFile(projectDir: string): string | undefined {
  const envPath = path.join(projectDir, ".env");
  if (!fs.existsSync(envPath)) return undefined;
  const match = fs.readFileSync(envPath, "utf8").match(/^[ \t]*(?:export[ \t]+)?DB_DSN[ \t]*=[ \t]*(.*)$/m);
  if (!match) return undefined;

  let value = match[1].trim();
  const quote = value[0];
  if (quote === '"' || quote === "'") {
    // a quoted value ends at its closing quote; anything after it is a comment
    const end = value.indexOf(quote, 1);
    value = end === -1 ? value.slice(1) : value.slice(1, end);
  } else {
    // unquoted: strip a trailing ` # comment`, matching the Makefile's
    // sed -E 's/[[:space:]]+#.*$//'. Not a bare `#` — that's legal in a URL.
    value = value.replace(/[ \t]+#.*$/, "").trim();
  }
  return value || undefined;
}

// findDependents lists the .go files in *other* domains that import this one.
// Import path match, not a bare package-name match: `orders` appears in plenty
// of strings and comments, but only an import of
// "<goModule>/internal/app/orders" is a real compile-time dependency.
function findDependents(projectDir: string, goModule: string, modulePath: string): string[] {
  // The package itself, or one of its subpackages — and nothing else. Dropping
  // the closing quote to catch `/model` was matching on a bare prefix too, so
  // `undo module order` was refused by every module whose name merely starts
  // with it: internal/app/orderitem imports nothing from internal/app/order,
  // but the second path contains the first.
  const base = `"${goModule}/internal/app/${modulePath}`;
  const importsIt = (src: string) => src.includes(`${base}"`) || src.includes(`${base}/`);

  const appDir = path.join(projectDir, "internal", "app");
  const hits: string[] = [];

  for (const pkg of existingModulePackages(projectDir)) {
    if (pkg === modulePath) continue;
    for (const file of goFilesIn(path.join(appDir, pkg))) {
      if (importsIt(fs.readFileSync(file, "utf8"))) {
        hits.push(path.relative(projectDir, file));
      }
    }
  }
  return hits;
}

function goFilesIn(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return goFilesIn(full);
    return entry.name.endsWith(".go") ? [full] : [];
  });
}
