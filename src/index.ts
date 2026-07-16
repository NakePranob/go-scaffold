#!/usr/bin/env node
import { Command } from "commander";
import { select } from "@inquirer/prompts";
import pc from "picocolors";
import { createProject } from "./commands/create";
import { generateModule } from "./commands/generate";
import { generateMethod } from "./commands/method";
import { MethodType, GetMethodMode } from "./types";

const program = new Command();
program
  .name("go-scaffold")
  .description("Scaffold Gin + GORM + Postgres Go backend projects with a consistent domain-module standard")
  .version("0.1.0");

program
  .command("create [name]")
  .alias("c")
  .description("scaffold a new project (bare skeleton — add domains with `generate module`)")
  .option("--defaults", "skip the wizard, use defaults (for CI/scripting)")
  .option("--no-docker", "skip docker-compose.yml (only applies with --defaults)")
  .option("--no-openapi-docs", "skip docs/openapi.yaml (only applies with --defaults)")
  .option("--versioning", "enable folder-based domain versioning (only applies with --defaults)")
  .action(async (name, opts) => {
    try {
      await createProject(name, {
        defaults: opts.defaults,
        docker: opts.docker,
        openapiDocs: opts.openapiDocs,
        versioning: opts.versioning,
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
        ],
      });
      if (target === "module") {
        await generateModule(undefined, { full: true });
      } else {
        await generateMethod(undefined, undefined, {});
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
  .option("--module-version <version>", "target a specific version folder (requires versioning enabled)")
  .action(async (name, opts) => {
    try {
      await generateModule(name, { full: opts.full, moduleVersion: opts.moduleVersion });
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
  .option("--module-version <version>", "target a specific version folder (requires versioning enabled)")
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
        moduleVersion: opts.moduleVersion,
      });
    } catch (err) {
      console.error(pc.red((err as Error).message));
      process.exitCode = 1;
    }
  });

program.parseAsync(process.argv);
