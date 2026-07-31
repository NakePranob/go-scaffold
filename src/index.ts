#!/usr/bin/env node
import { Command } from "commander";
import { select } from "@inquirer/prompts";
import pc from "picocolors";
import { createProject } from "./commands/create";
import { generateModule } from "./commands/generate";
import { generateMethod } from "./commands/method";
import { generateMigration } from "./commands/migration";
import { removeModule } from "./commands/remove";
import { cliVersion } from "./utils/version";
import { addWorker } from "./commands/worker";
import { addAuth } from "./commands/auth";
import { addRbac } from "./commands/rbac";
import { MethodType, GetMethodMode } from "./types";

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
  .option("--api-prefix <prefix>", 'URL prefix every route is grouped under (default "v1"; pass "" for none)')
  .action(async (name, opts) => {
    try {
      await createProject(name, {
        defaults: opts.defaults,
        docker: opts.docker,
        openapiDocs: opts.openapiDocs,
        apiPrefix: opts.apiPrefix,
      });
    } catch (err) {
      console.error(pc.red((err as Error).message));
      process.exitCode = 1;
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
          { name: "Module (full CRUD domain)", value: "module" },
          { name: "Method (add one endpoint to an existing module)", value: "method" },
          { name: "Migration (reserve a timestamped up/down SQL file pair)", value: "migration" },
        ],
      });
      if (target === "module") {
        await generateModule(undefined, { full: true });
      } else if (target === "method") {
        await generateMethod(undefined, undefined, {});
      } else {
        await generateMigration(undefined);
      }
    } catch (err) {
      console.error(pc.red((err as Error).message));
      process.exitCode = 1;
    }
  });

generate
  .command("module [name]")
  .alias("m")
  .description("scaffold a domain module — full CRUD by default, or a bare skeleton with --no-full")
  .option(
    "--no-full",
    "minimal skeleton (model/errors/repository, no default CRUD) — add endpoints one at a time with `generate method`"
  )
  .option("--auth", "require a valid access token for this module's routes (needs `add auth`)")
  .option("--permission <code>", "also require this permission via authz.Require (needs `add rbac`; implies --auth)")
  .action(async (name, opts) => {
    try {
      await generateModule(name, { full: opts.full, auth: opts.auth, permission: opts.permission });
    } catch (err) {
      console.error(pc.red((err as Error).message));
      process.exitCode = 1;
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
      console.error(pc.red((err as Error).message));
      process.exitCode = 1;
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
      console.error(pc.red((err as Error).message));
      process.exitCode = 1;
    }
  });

const add = program.command("add").description("add opt-in infrastructure to an existing go-scaffold project");

add
  .command("worker")
  .description("add Redis, an Asynq task queue, SMTP mail, and cmd/worker (opt-in — most projects don't need this on day one)")
  .action(async () => {
    try {
      await addWorker();
    } catch (err) {
      console.error(pc.red((err as Error).message));
      process.exitCode = 1;
    }
  });

add
  .command("auth")
  .description("add email/password auth: JWT access tokens, Redis-backed refresh token rotation, register/login/refresh/logout/me (requires `add worker` first)")
  .action(async () => {
    try {
      await addAuth();
    } catch (err) {
      console.error(pc.red((err as Error).message));
      process.exitCode = 1;
    }
  });

add
  .command("rbac")
  .description("add role-based access control: roles/permissions admin API, cached Authz middleware, PATCH /users/:id/set-role (requires `add auth` first)")
  .action(async () => {
    try {
      await addRbac();
    } catch (err) {
      console.error(pc.red((err as Error).message));
      process.exitCode = 1;
    }
  });

const remove = program
  .command("remove")
  .alias("rm")
  .description("remove a domain module (deletes the package + un-wires main.go/openapi.yaml/migration)")
  .action(async () => {
    // bare `remove`/`rm` — module is the only target, so prompt for the name
    try {
      await removeModule(undefined, {});
    } catch (err) {
      console.error(pc.red((err as Error).message));
      process.exitCode = 1;
    }
  });

remove
  .command("module [name]")
  .alias("m")
  .description("delete a domain module and reverse everything `generate module` wired up")
  .option("-y, --yes", "skip the confirmation prompt")
  .action(async (name, opts) => {
    try {
      await removeModule(name, { yes: opts.yes });
    } catch (err) {
      console.error(pc.red((err as Error).message));
      process.exitCode = 1;
    }
  });

program.parseAsync(process.argv);
