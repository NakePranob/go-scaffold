#!/usr/bin/env node
import { Command } from "commander";
import { confirm, select } from "@inquirer/prompts";
import pc from "picocolors";
import { createProject } from "./commands/create";
import { generateModule } from "./commands/generate";
import { generateMethod } from "./commands/method";
import { generateMigration } from "./commands/migration";
import { undoModule } from "./commands/undo";
import { cliVersion } from "./utils/version";
import { addWorker } from "./commands/worker";
import { addAuth } from "./commands/auth";
import { addRbac } from "./commands/rbac";
import { addObservability } from "./commands/observability";
import { MethodType, GetMethodMode, QueueBackend } from "./types";
import { promptQueueBackend } from "./prompts/worker-wizard";
import { readConfig } from "./utils/config";

// fail is every command's catch: one place so the two non-obvious cases stay
// consistent. @inquirer/prompts throws ExitPromptError both on Ctrl-C and when
// stdin isn't a TTY, and its raw message ("User force closed the prompt with 0
// null") tells a user nothing — the CI case especially, where the real problem
// is a missing argument, not the prompt.
function fail(err: unknown): void {
  const message = (err as Error).message ?? String(err);
  if ((err as Error).name === "ExitPromptError") {
    console.error(
      pc.red(
        process.stdin.isTTY
          ? "aborted"
          : "no interactive terminal to prompt on — pass every value as an argument/flag (see --help), or add --defaults"
      )
    );
  } else {
    console.error(pc.red(message));
  }
  process.exitCode = 1;
}

const program = new Command();
program
  .name("go-scaffold")
  .description("Scaffold Gin + GORM + Postgres Go backend projects with a consistent domain-module standard")
  .version(cliVersion());

program
  .command("create [name]")
  .alias("c")
  .description("scaffold a new project (bare skeleton — add domains with `generate module`)")
  .option("--defaults", "skip the wizard, use defaults (for CI/scripting)")
  .option("--no-docker", "skip docker-compose.yml (only applies with --defaults)")
  .option("--no-openapi-docs", "skip docs/openapi.yaml (only applies with --defaults)")
  .option("--observability", "add Prometheus /metrics + OpenTelemetry tracing (only applies with --defaults; off by default)")
  .option("--api-prefix <prefix>", 'URL prefix every route is grouped under (default "v1"; pass "" for none)')
  .action(async (name, opts) => {
    try {
      await createProject(name, {
        defaults: opts.defaults,
        docker: opts.docker,
        openapiDocs: opts.openapiDocs,
        observability: opts.observability,
        apiPrefix: opts.apiPrefix,
      });
    } catch (err) {
      fail(err);
    }
  });

const generate = program
  .command("generate")
  .alias("g")
  .description("add to an existing go-scaffold project")
  .action(async () => {
    // bare `generate`/`g` — ask which target, then delegate (each subcommand
    // still prompts for anything else it's missing, e.g. the name).
    try {
      const target = await select({
        message: "What do you want to generate?",
        choices: [
          { name: "Module (safe minimal domain; add methods explicitly)", value: "module" },
          { name: "Method (add one endpoint to an existing module)", value: "method" },
          { name: "Migration (reserve a timestamped up/down SQL file pair)", value: "migration" },
        ],
      });
      if (target === "module") {
        await generateModule(undefined, { full: false });
      } else if (target === "method") {
        await generateMethod(undefined, undefined, {});
      } else {
        await generateMigration(undefined);
      }
    } catch (err) {
      fail(err);
    }
  });

generate
  .command("module [name]")
  .alias("m")
  .description("scaffold a safe minimal domain module; opt into a CRUD skeleton with --full")
  .option(
    "--full",
    "generate a CRUD skeleton (DTO fields/business rules remain TODO); minimal is the safe default"
  )
  .option("--no-full", "deprecated compatibility alias; minimal is already the default")
  .option("--auth", "require a valid access token for this module's routes (needs `add auth`)")
  .option("--permission <code>", "also require this permission via authz.Require (needs `add rbac`; pass --auth too)")
  .action(async (name, opts) => {
    try {
      await generateModule(name, { full: opts.full, auth: opts.auth, permission: opts.permission });
    } catch (err) {
      fail(err);
    }
  });

generate
  .command("method [module] [name]")
  .alias("me")
  .description("add one endpoint to an existing module (patches handler/service in place)")
  .option("--type <type>", "get|post|put|patch|delete")
  .option("--get-mode <mode>", "for --type get only: all|one")
  .option("--field <name>", "for --type get --get-mode one: the lookup field (e.g. email, status)")
  .action(async (moduleName, methodName, opts) => {
    try {
      const type = opts.type as MethodType | undefined;
      if (type && !["get", "post", "put", "patch", "delete"].includes(type)) {
        throw new Error(`--type must be one of: get, post, put, patch, delete (got "${type}")`);
      }
      const getMode = opts.getMode as GetMethodMode | undefined;
      if (getMode && !["all", "one"].includes(getMode)) {
        throw new Error(`--get-mode must be "all" or "one" (got "${getMode}")`);
      }
      await generateMethod(moduleName, methodName, {
        type,
        getMode,
        field: opts.field,
      });
    } catch (err) {
      fail(err);
    }
  });

generate
  .command("migration [name]")
  .alias("mig")
  .description("reserve a timestamped migrations/<version>_<name>.{up,down}.sql pair (stubs only — you write the SQL)")
  .action(async (name) => {
    try {
      await generateMigration(name);
    } catch (err) {
      fail(err);
    }
  });

// confirmAdd prints what a target is about to do and asks before it happens
// — the interactive menu is the one path where nothing was typed out loud
// yet, so it's the one place a summary earns its keep. A direct
// `add auth --store redis` skips this on purpose: that command line already
// says what it does, and asking again would just be in a script's way.
//
// Defaults to no, like `undo`'s confirm and unlike the create wizard's. This
// prompt lands immediately after a select, where Enter meant "choose this" a
// keystroke ago — carrying that Enter straight through would write ~15 files
// and patch main.go, and there is no `undo auth` to walk it back. A stray
// Enter costs a re-run instead.
async function confirmAdd(summaryLines: string[]): Promise<void> {
  console.log(pc.bold("\nThis will:"));
  for (const line of summaryLines) console.log(`  ${pc.dim("•")} ${line}`);
  console.log();

  const proceed = await confirm({ message: "Proceed?", default: false });
  if (!proceed) {
    throw new Error("cancelled — nothing was written");
  }
}

const add = program
  .command("add")
  .description("add opt-in infrastructure to an existing go-scaffold project")
  .action(async () => {
    // bare `add` — ask which target, then delegate (each subcommand still
    // prompts for anything else it's missing, e.g. the queue backend).
    try {
      const target = await select({
        message: "What do you want to add?",
        choices: [
          { name: "Worker (background job queue, SMTP mail, cmd/worker)", value: "worker" },
          { name: "Auth (JWT access tokens, refresh rotation, register/login/refresh/logout/me)", value: "auth" },
          { name: "RBAC (roles/permissions, cached Authz middleware — requires auth)", value: "rbac" },
          { name: "Observability (Prometheus /metrics + OpenTelemetry tracing)", value: "observability" },
        ],
      });

      // read once, up front: every add command reads it anyway, and the
      // summary below needs to know what's already installed (e.g. whether
      // auth's mail goes out inline or through an existing queue).
      const config = readConfig(process.cwd());

      if (target === "worker") {
        const backend = await resolveQueueBackend({});
        await confirmAdd([
          `add internal/platform/{queue,mail}/ and cmd/worker/ (queue backend: ${backend === "river" ? "postgres/River" : "redis/Asynq"})`,
          backend === "river"
            ? "no extra service to run — jobs are rows in your own Postgres"
            : pc.yellow("requires Redis to be running"),
        ]);
        await addWorker(backend);
      } else if (target === "auth") {
        await confirmAdd([
          "add internal/app/user/, internal/shared/middleware/auth.go, and cmd/seed",
          "tokens + rate-limit counters: Postgres (user_svc.auth_tokens), in-process — no extra service",
          config.features.worker
            ? "verification/reset mail: queued through the worker already installed"
            : pc.yellow("verification/reset mail: sent inline over SMTP (no worker yet) — /auth/register and /auth/forgot-password block until it's sent"),
        ]);
        await addAuth("postgres");
      } else if (target === "rbac") {
        if (!config.features.auth) {
          throw new Error("`add rbac` requires `add auth` first — there's no Role claim to check permissions against otherwise");
        }
        await confirmAdd(["add roles/permissions admin API, cached Authz middleware, and PATCH /users/:id/set-role"]);
        await addRbac();
      } else {
        await confirmAdd([
          "add Prometheus /metrics + OpenTelemetry tracing",
          "patch cmd/api/wiring.go and internal/platform/database to wire it in",
        ]);
        await addObservability();
      }
    } catch (err) {
      fail(err);
    }
  });

add
  .command("worker")
  .description("add a background job queue, SMTP mail, and cmd/worker (opt-in — most projects don't need this on day one)")
  .option("--queue <backend>", "where jobs are stored: postgres (River, default) or redis (Asynq)")
  .option("--defaults", "skip the prompt, use the Postgres-backed queue")
  .action(async (opts: { queue?: string; defaults?: boolean }) => {
    try {
      await addWorker(await resolveQueueBackend(opts));
    } catch (err) {
      fail(err);
    }
  });

// resolveQueueBackend maps the friendly flag values people actually type
// ("postgres", "redis") onto the adapter names, and falls back to the prompt
// when neither --queue nor --defaults was given.
async function resolveQueueBackend(opts: { queue?: string; defaults?: boolean }): Promise<QueueBackend> {
  if (opts.queue) {
    const normalized = opts.queue.trim().toLowerCase();
    const byName: Record<string, QueueBackend> = {
      postgres: "river",
      river: "river",
      pg: "river",
      redis: "asynq",
      asynq: "asynq",
    };
    const backend = byName[normalized];
    if (!backend) {
      throw new Error(`unknown --queue ${opts.queue} — use "postgres" (River) or "redis" (Asynq)`);
    }
    return backend;
  }
  if (opts.defaults) return "river";
  return promptQueueBackend();
}

add
  .command("auth")
  .description("add email/password auth: JWT access tokens, refresh token rotation, register/login/refresh/logout/me (requires `add worker` first)")
  .option(
    "--store <store>",
    'where tokens and rate-limit counters live: "postgres" (default, no extra service) or "redis" (exact across replicas)'
  )
  .action(async (opts: { store?: string }) => {
    try {
      const store = (opts.store ?? "postgres").trim().toLowerCase();
      if (store !== "postgres" && store !== "redis") {
        throw new Error(`unknown --store ${opts.store} — use "postgres" or "redis"`);
      }
      await addAuth(store);
    } catch (err) {
      fail(err);
    }
  });

add
  .command("rbac")
  .description("add role-based access control: roles/permissions admin API, cached Authz middleware, PATCH /users/:id/set-role (requires `add auth` first)")
  .action(async () => {
    try {
      await addRbac();
    } catch (err) {
      fail(err);
    }
  });

add
  .command("observability")
  .description("add Prometheus /metrics + OpenTelemetry tracing for Gin + GORM (also available at `create` time via --observability)")
  .action(async () => {
    try {
      await addObservability();
    } catch (err) {
      fail(err);
    }
  });

const undo = program
  .command("undo")
  .description("undo a `generate module` you didn't mean to run (typo'd name, domain you decided against)")
  .action(async () => {
    // bare `undo` — module is the only target, so prompt for the name
    try {
      await undoModule(undefined, {});
    } catch (err) {
      fail(err);
    }
  });

undo
  .command("module [name]")
  .alias("m")
  .description("delete a generated module and everything it wired up, migration files included")
  .option("-y, --yes", "skip the confirmation prompt")
  .action(async (name, opts) => {
    try {
      await undoModule(name, { yes: opts.yes });
    } catch (err) {
      fail(err);
    }
  });

// `remove module` was this command's old name, back when it claimed to retire
// a domain that might be live — and so kept the migration files, which for the
// case people actually used it in (undoing a mistake) meant a typo's migration
// ran on every database created from then on. Kept as an alias rather than
// deleted outright: a muscle-memory `rm m` shouldn't be an unrecognised-command
// error, and the semantics only got safer.
const remove = program.command("remove", { hidden: true }).alias("rm");
remove
  .command("module [name]")
  .alias("m")
  .option("-y, --yes", "skip the confirmation prompt")
  .action(async (name, opts) => {
    console.error(pc.yellow("`remove module` is now `undo module` — running that instead."));
    try {
      await undoModule(name, { yes: opts.yes });
    } catch (err) {
      fail(err);
    }
  });

program.parseAsync(process.argv);
