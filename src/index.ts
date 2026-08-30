#!/usr/bin/env node
import { Command, Option } from "commander";
import { NO_TTY_MESSAGE, confirm, input, select } from "./prompts/interactive";
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
import { MethodType, GetMethodMode, QueueBackend, AuthStore, BrowserTopology, ModuleProfile } from "./types";
import { promptQueueBackend } from "./prompts/worker-wizard";
import {
  DEFAULT_BROWSER_TOPOLOGY,
  promptAuthStore,
  promptBrowserTopology,
  validateBrowserTopology,
} from "./prompts/auth-wizard";
import {
  promptAdvancedModuleArchitecture,
  promptApplicationStyle,
  promptModuleAuth,
  promptModuleName,
  promptModulePermission,
  promptModuleProfile,
  promptModuleSurface,
} from "./prompts/generate-wizard";
import { configureProject, showProjectConfig, validateProjectConfig } from "./commands/config";
import { checkProject } from "./commands/check";
import { isProjectDir, parseModuleProfile, readConfig } from "./utils/config";
import { architectureForModuleProfile, moduleProfileFor } from "./utils/module-profile";

// fail is every command's catch: one place so the two non-obvious cases stay
// consistent. @inquirer/prompts throws ExitPromptError on Ctrl-C, and its raw
// message ("User force closed the prompt with 0 null") tells a user nothing.
// The no-TTY case normally never reaches here — prompts/interactive.ts rejects
// before a prompt starts — but stdin can also close mid-prompt, which arrives
// as the same error and deserves the same advice rather than "aborted".
function fail(err: unknown): void {
  const message = (err as Error).message ?? String(err);
  if ((err as Error).name === "ExitPromptError") {
    console.error(pc.red(process.stdin.isTTY ? "aborted" : NO_TTY_MESSAGE));
  } else {
    console.error(pc.red(message));
  }
  process.exitCode = 1;
}

const program = new Command();
program
  .name("go-scaffold")
  .description(
    "Scaffold Gin + GORM + Postgres Go backend projects with a consistent domain-module standard\n\n" +
      "Run `go-scaffold` with no arguments to pick what to do from a menu. Interactive commands ask for values you omit; read-only commands (`check`, `config show`, `config validate`) print or check state without prompts."
  )
  .version(cliVersion());

program
  .command("check")
  .description("validate the hexagonal split layout, process composition boundary, layer dependencies, and service/CQRS contract")
  .action(() => {
    try {
      checkProject();
    } catch (err) {
      fail(err);
    }
  });

program
  .command("create [name]")
  .alias("c")
  .description("scaffold a new project (bare skeleton — add domains with `generate module`)")
  .option("--defaults", "skip settings prompts; use Docker/OpenAPI on, no prefix, and Lean module defaults (still asks for name if omitted)")
  .option("--no-docker", "do not create docker-compose.yml or include a local Postgres service")
  .option("--no-openapi-docs", "do not create docs/openapi.yaml or per-module OpenAPI files")
  .option("--observability", "include Prometheus /metrics and OpenTelemetry tracing; off unless this flag is passed")
  .option("--api-prefix <prefix>", 'group every API route under a prefix such as "v1" or "api/v1"; omit for no prefix')
  .option("--module-profile <profile>", "default profile for future modules: lean, crud, or cqrs; replaces the two profile questions")
  .option("--module-surface <surface>", "legacy axis flag for future modules: minimal or crud; wizard asks when omitted")
  .option("--application-style <style>", "legacy axis flag for future modules: service or cqrs; wizard asks when omitted")
  .action(async (name, opts) => {
    try {
      await createProject(name, {
        defaults: opts.defaults,
        docker: opts.docker,
        openapiDocs: opts.openapiDocs,
        observability: opts.observability,
        apiPrefix: opts.apiPrefix,
        moduleProfile: opts.moduleProfile,
        moduleSurface: opts.moduleSurface,
        applicationStyle: opts.applicationStyle,
      });
    } catch (err) {
      fail(err);
    }
  });

// runModuleWizard resolves everything `generate module` needs, asking for
// whatever wasn't passed as a flag. Shared by the bare menu and by
// `generate module` itself, so both offer the same choices — the flags exist
// for scripting, not as the only way to reach a decision.
//
// --defaults is the escape hatch CI and scripts use: it takes the project's
// recorded module defaults and asks nothing. Fresh projects retain the
// historical minimal/service/no-auth result.
type ModuleWizardOptions = {
  profile?: ModuleProfile;
  full?: boolean;
  cqrs?: boolean;
  auth?: boolean;
  permission?: string;
  defaults?: boolean;
};

function assertModuleWizardInputs(
  name: string | undefined,
  opts: ModuleWizardOptions,
  config: ReturnType<typeof readConfig>
): void {
  if (process.stdin.isTTY) return;

  const missing: string[] = [];
  if (name === undefined) missing.push("<name>");

  // --defaults answers every optional wizard question. The name is still
  // required because there is no safe module name to invent.
  if (!opts.defaults) {
    if (opts.profile === undefined && opts.full === undefined) missing.push("--profile or --full/--no-full");
    if (opts.profile === undefined && opts.cqrs === undefined) missing.push("--profile or --cqrs");
    if (config.features.auth && opts.auth === undefined) {
      missing.push("--auth (or --defaults for no auth)");
    }
    if (opts.auth && config.features.rbac && opts.permission === undefined) {
      missing.push("--permission <code> (or --defaults for no permission)");
    }
  }

  if (missing.length > 0) {
    throw new Error(
      `no interactive terminal to prompt on — \`generate module\` is missing: ${missing.join(", ")}. ` +
        "Pass the missing choices as flags, or add --defaults."
    );
  }
}

async function runModuleWizard(
  name: string | undefined,
  opts: ModuleWizardOptions
): Promise<void> {
  let { full, cqrs, auth, permission } = opts;
  // Read before checking the prompt contract so the error can name the
  // feature-dependent auth/RBAC choices, and so a non-project still fails
  // with the useful project error rather than a list of flags.
  const config = readConfig(process.cwd());
  assertModuleWizardInputs(name, opts, config);

  if (opts.profile) {
    const architecture = architectureForModuleProfile(opts.profile);
    full = architecture.moduleSurface === "crud";
    cqrs = architecture.applicationStyle === "cqrs";
  }

  if (!opts.defaults) {
    // auth/permission questions are only asked when the project actually has
    // the features they depend on — offering them otherwise would present a
    // choice whose only outcome is generateModule's error.
    if (name === undefined) name = await promptModuleName();
    if (opts.profile === undefined && full === undefined && cqrs === undefined) {
      const profile = await promptModuleProfile(
        moduleProfileFor(config.architecture.defaultModuleSurface, config.architecture.defaultApplicationStyle)
      );
      if (profile === "advanced") {
        const architecture = await promptAdvancedModuleArchitecture(
          config.architecture.defaultModuleSurface,
          config.architecture.defaultApplicationStyle
        );
        full = architecture.moduleSurface === "crud";
        cqrs = architecture.applicationStyle === "cqrs";
      } else {
        const architecture = architectureForModuleProfile(profile);
        full = architecture.moduleSurface === "crud";
        cqrs = architecture.applicationStyle === "cqrs";
      }
    } else {
      // A legacy axis flag is still an explicit answer. Ask only for the
      // other axis so `--full` never gets silently changed by the profile
      // selector.
      if (full === undefined) {
        full = (await promptModuleSurface(config.architecture.defaultModuleSurface)) === "crud";
      }
      if (cqrs === undefined) {
        cqrs = (await promptApplicationStyle(config.architecture.defaultApplicationStyle)) === "cqrs";
      }
    }
    if (auth === undefined && config.features.auth) auth = await promptModuleAuth();
    if (auth && permission === undefined && config.features.rbac) permission = await promptModulePermission();
  } else {
    // --defaults means "use this project's recorded defaults". Fresh projects
    // still resolve to the historical minimal/service behaviour, while a
    // project config wizard can intentionally choose another default for new
    // modules without making CI scripts interactive.
    full ??= config.architecture.defaultModuleSurface === "crud";
    cqrs ??= config.architecture.defaultApplicationStyle === "cqrs";
  }

  await generateModule(name, { full: full ?? false, cqrs: cqrs ?? false, auth, permission });
}

// runGenerateWizard is `generate`/`g` run bare — asks which target, then
// delegates (each subcommand still prompts for anything else it's missing,
// e.g. the name). Pulled out to a function, not just the command's .action,
// so the top-level bare `go-scaffold` invocation can offer the exact same
// choice without duplicating it.
async function runGenerateWizard(): Promise<void> {
  const target = await select({
    message: "What do you want to generate?",
    choices: [
      { name: "Module (choose Lean / CRUD / CQRS profile)", value: "module" },
      { name: "Method (add one endpoint to an existing module)", value: "method" },
      { name: "Migration (reserve a timestamped up/down SQL file pair)", value: "migration" },
    ],
  });
  if (target === "module") {
    await runModuleWizard(undefined, {});
  } else if (target === "method") {
    await generateMethod(undefined, undefined, {});
  } else {
    await generateMigration(undefined);
  }
}

const generate = program
  .command("generate")
  .alias("g")
  .description("add a module, endpoint, or migration to an existing project; bare `generate` opens a target wizard")
  .action(async () => {
    try {
      await runGenerateWizard();
    } catch (err) {
      fail(err);
    }
  });

generate
  .command("module [name]")
  .alias("m")
  .description("scaffold a domain module; the wizard asks for a Lean, CRUD, CQRS, or Advanced profile")
  .option(
    "--profile <profile>",
    "choose the architecture preset: lean (minimal + service), crud (CRUD + service), or cqrs (minimal + CQRS); auth may still prompt"
  )
  .option(
    "--full",
    "legacy alias for the CRUD profile: generate list/get/create/update/delete skeletons; fields and rules remain TODO"
  )
  .option(
    "--cqrs",
    "legacy axis flag: split state-changing commands from read-only queries; combine with --full for CRUD + CQRS"
  )
  // kept working for muscle memory, hidden from help: minimal is already the
  // default, so advertising a flag that asks for it is pure noise.
  .addOption(new Option("--no-full", "deprecated compatibility alias; minimal is already the default").hideHelp())
  .option("--auth", "require a valid access token for this module's routes (needs `add auth`; omitted means public)")
  .option("--permission <code>", "also require this permission via authz.Require (needs `add rbac` and --auth; e.g. users:manage)")
  .option("--defaults", "skip every wizard question; use recorded project defaults and keep the module public (for CI/scripting)")
  .action(async (name, opts) => {
    try {
      const profile = parseModuleProfile(opts.profile);
      if (profile && (opts.full !== undefined || opts.cqrs !== undefined)) {
        throw new Error("--profile cannot be combined with --full, --no-full, or --cqrs — choose one configuration style");
      }
      // anything not passed as a flag gets asked for — declaring both --full
      // and --no-full leaves opts.full undefined when neither is given, which
      // is exactly the "not answered yet" signal runModuleWizard needs.
      await runModuleWizard(name, {
        profile,
        full: opts.full,
        cqrs: opts.cqrs,
        auth: opts.auth,
        permission: opts.permission,
        defaults: opts.defaults,
      });
    } catch (err) {
      fail(err);
    }
  });

const configCommand = program
  .command("config")
  .description("configure future module defaults interactively, or inspect/validate the project config")
  .action(async () => {
    try {
      await configureProject();
    } catch (err) {
      fail(err);
    }
  });

configCommand
  .command("show")
  .description("print the resolved project config, including installed features and module choices; no wizard")
  .action(() => {
    try {
      showProjectConfig();
    } catch (err) {
      fail(err);
    }
  });

configCommand
  .command("validate")
  .description("validate project config and detected scaffold state without changing files; no wizard")
  .action(() => {
    try {
      validateProjectConfig();
    } catch (err) {
      fail(err);
    }
  });

generate
  .command("method [module] [name]")
  .alias("me")
  .description("add one endpoint to an existing module; omitted module, name, and endpoint details are asked by the wizard")
  .option("--type <type>", "HTTP verb: get, post, put, patch, or delete; omitted means the wizard asks")
  .option("--get-mode <mode>", "GET only: all for a list endpoint or one for a lookup by another field")
  .option("--field <name>", "GET one only: lookup column such as email/status/slug; id is already the built-in lookup")
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
  .description("reserve a timestamped up/down SQL pair; omitted name opens a migration-name wizard and the SQL remains your responsibility")
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
async function confirmAdd(summaryLines: string[], opts: { yes?: boolean } = {}): Promise<void> {
  if (opts.yes) return;
  console.log(pc.bold("\nThis will:"));
  for (const line of summaryLines) console.log(`  ${pc.dim("•")} ${line}`);
  console.log();

  const proceed = await confirm({ message: "Proceed?", default: false });
  if (!proceed) {
    throw new Error("cancelled — nothing was written");
  }
}

// runAddWizard is `add` run bare — asks which target, then delegates. Pulled
// out to a function for the same reason as runGenerateWizard above: the
// top-level bare `go-scaffold` invocation reuses it verbatim.
async function runAddWizard(): Promise<void> {
  // read once, up front: every add command reads it anyway, the summary below
  // needs to know what's already installed (e.g. whether auth's mail goes out
  // inline or through an existing queue), and so does the menu itself.
  const config = readConfig(process.cwd());

  // Each add is once-only, and rbac needs auth first. Both facts are already
  // known here, so say them in the menu rather than letting someone walk three
  // steps and a confirmation to reach "already been added".
  const target = await select({
    message: "What do you want to add?",
    choices: [
      {
        name: "Worker (background job queue, SMTP mail, cmd/worker)",
        value: "worker",
        disabled: config.features.worker ? "— already installed" : false,
      },
      {
        name: "Auth (JWT access tokens, refresh rotation, register/login/refresh/logout/me)",
        value: "auth",
        disabled: config.features.auth ? "— already installed" : false,
      },
      {
        name: "RBAC (roles/permissions, cached Authz middleware)",
        value: "rbac",
        disabled: config.features.rbac
          ? "— already installed"
          : config.features.auth
            ? false
            : "— needs `add auth` first",
      },
      {
        name: "Observability (Prometheus /metrics + OpenTelemetry tracing)",
        value: "observability",
        disabled: config.features.observability ? "— already installed" : false,
      },
    ],
  });

  if (target === "worker") {
    await runAddWorker(await resolveQueueBackend({}), {});
  } else if (target === "auth") {
    // `--store` is a real fork (it decides whether Redis joins the project at
    // all), so the menu has to ask it the same way the worker menu asks for
    // its queue backend — a choice only reachable by knowing the flag name
    // isn't a choice for anyone driving this from the menu.
    await runAddAuth(await promptAuthStore(), await promptBrowserTopology(), {});
  } else if (target === "rbac") {
    await runAddRbac({});
  } else {
    await runAddObservability({});
  }
}

// The four add targets, each as "summarise -> confirm -> run". They exist as
// functions so `add worker` typed straight out and the menu's Worker entry go
// through the same path: an add writes ~15 files and patches wiring.go with no
// `undo` to walk it back, and which of the two ways you asked for it should
// not decide whether you get told that first.
//
// --yes skips the confirmation (and --defaults implies it, since it already
// means "ask me nothing"), which is what CI and scripts pass.
interface AddOpts {
  yes?: boolean;
}

async function runAddWorker(backend: QueueBackend, opts: AddOpts): Promise<void> {
  await confirmAdd(
    [
      `add internal/platform/{queue,mail}/ and cmd/worker/ (queue backend: ${backend === "river" ? "postgres/River" : "redis/Asynq"})`,
      backend === "river"
        ? "no extra service to run — jobs are rows in your own Postgres"
        : pc.yellow("requires Redis to be running"),
    ],
    opts
  );
  await addWorker(backend);
}

async function runAddAuth(store: AuthStore, browserTopology: BrowserTopology, opts: AddOpts): Promise<void> {
  const config = readConfig(process.cwd());
  await confirmAdd(
    [
      "add internal/app/user/, internal/shared/middleware/auth.go, and cmd/seed",
      `browser OAuth: frontend-owned callback with server-side provider redirect URI (${browserTopology})`,
      store === "postgres"
        ? "refresh + recovery tokens: Postgres (user_svc.auth_tokens), rate-limit counters in-process — no extra service"
        : pc.yellow("refresh tokens + rate-limit counters: Redis; recovery tokens: Postgres — requires Redis"),
      config.features.worker
        ? "verification/reset mail: queued through the worker already installed"
        : pc.yellow("verification/reset mail: sent inline over SMTP (no worker yet) — /auth/register and /auth/forgot-password block until it's sent"),
    ],
    opts
  );
  await addAuth(store, process.cwd(), browserTopology);
}

type BrowserAuthFlagOpts = {
  browserTopology?: string;
  defaults?: boolean;
  yes?: boolean;
};

// Explicit browser flags are intentionally resolved before the confirmation
// summary. `--defaults` is the stable non-TTY escape hatch; `--yes` with no
// browser flags also uses the local default so existing CI invocations such as
// `add auth --store postgres --yes` do not unexpectedly start prompting.
async function resolveBrowserTopology(opts: BrowserAuthFlagOpts): Promise<BrowserTopology> {
  if (opts.browserTopology !== undefined) return validateBrowserTopology(opts.browserTopology);
  if (opts.defaults || opts.yes) return DEFAULT_BROWSER_TOPOLOGY;
  return promptBrowserTopology();
}

async function runAddRbac(opts: AddOpts): Promise<void> {
  const config = readConfig(process.cwd());
  if (!config.features.auth) {
    throw new Error("`add rbac` requires `add auth` first — there's no Role claim to check permissions against otherwise");
  }
  await confirmAdd(["add roles/permissions admin API, cached Authz middleware, and PATCH /users/:id/set-role"], opts);
  await addRbac();
}

async function runAddObservability(opts: AddOpts): Promise<void> {
  const config = readConfig(process.cwd());
  await confirmAdd(
    [
      "add Prometheus /metrics + OpenTelemetry tracing",
      "patch cmd/api/wiring.go and internal/platform/database to wire it in — cmd/api only",
      ...(config.features.worker
        ? [pc.yellow("cmd/worker is not instrumented: no tracer provider there, so its spans are dropped and it serves no /metrics")]
        : []),
    ],
    opts
  );
  await addObservability();
}

const add = program
  .command("add")
  .description("add opt-in infrastructure to an existing project; bare `add` opens a worker/auth/RBAC/observability wizard")
  .action(async () => {
    try {
      await runAddWizard();
    } catch (err) {
      fail(err);
    }
  });

add
  .command("worker")
  .description("add a background job queue, SMTP mail, and cmd/worker (opt-in — most projects don't need this on day one)")
  .option("--queue <backend>", "where jobs are stored: postgres (River, default) or redis (Asynq)")
  .option("--defaults", "skip queue and confirmation prompts; use Postgres/River")
  .option("-y, --yes", "skip only the confirmation summary; an omitted queue still opens the queue wizard")
  .action(async (opts: { queue?: string; defaults?: boolean; yes?: boolean }) => {
    try {
      await runAddWorker(await resolveQueueBackend(opts), { yes: opts.yes || opts.defaults });
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
  .description(
    "add email/password auth: JWT access tokens, refresh rotation, device-session listing/revocation, register/login/refresh/logout/me (no prerequisites — without `add worker` the verification/reset mail is sent inline)"
  )
  .option(
    "--store <store>",
    'where tokens and rate-limit counters live: "postgres" (default, no extra service) or "redis" (exact across replicas)'
  )
  .option(
    "--browser-topology <topology>",
    "browser deployment topology for cookie/CORS policy: same-origin, same-site (different origin), or cross-site (requires HTTPS deployment)"
  )
  .option("--defaults", "skip store, browser-topology, and confirmation prompts; use Postgres plus local same-site defaults")
  .option("-y, --yes", "skip confirmation; omitted store/topology use local Postgres and same-site defaults")
  .action(
    async (opts: {
      store?: string;
      browserTopology?: string;
      defaults?: boolean;
      yes?: boolean;
    }) => {
      try {
        // Same shape as `add worker`: an explicit flag wins, --defaults takes
        // the documented default silently, and anything else asks rather than
        // picking a store the caller never saw a choice about.
        let store: AuthStore;
        if (opts.store !== undefined) {
          const normalized = opts.store.trim().toLowerCase();
          if (normalized !== "postgres" && normalized !== "redis") {
            throw new Error(`unknown --store ${opts.store} — use "postgres" or "redis"`);
          }
          store = normalized;
        } else if (opts.defaults) {
          store = "postgres";
        } else {
          store = await promptAuthStore();
        }
        const browserTopology = await resolveBrowserTopology(opts);
        await runAddAuth(store, browserTopology, { yes: opts.yes || opts.defaults });
      } catch (err) {
        fail(err);
      }
    }
  );

add
  .command("rbac")
  .description("add role-based access control: roles/permissions admin API, cached Authz middleware, and PATCH /users/:id/set-role (requires `add auth`; direct command only needs confirmation)")
  .option("-y, --yes", "skip the confirmation summary; the bare `add` wizard can select this target")
  .action(async (opts: { yes?: boolean }) => {
    try {
      await runAddRbac({ yes: opts.yes });
    } catch (err) {
      fail(err);
    }
  });

add
  .command("observability")
  .description("add Prometheus /metrics + OpenTelemetry tracing for Gin + GORM (also available at create time via --observability; direct command only needs confirmation)")
  .option("-y, --yes", "skip the confirmation summary; the bare `add` wizard can select this target")
  .action(async (opts: { yes?: boolean }) => {
    try {
      await runAddObservability({ yes: opts.yes });
    } catch (err) {
      fail(err);
    }
  });

const undo = program
  .command("undo")
  .description("undo a generated module and its wiring; bare `undo` opens a module selector and confirmation")
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
  .description("delete a generated module, its owned migrations/docs, and the wiring it added; omitted name opens a selector")
  .option("-y, --yes", "skip the destructive confirmation prompt (use only after reviewing the target)")
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
const remove = program
  .command("remove", { hidden: true })
  .alias("rm")
  .description("deprecated hidden alias for undo; kept for backwards compatibility");
remove
  .command("module [name]")
  .alias("m")
  .description("deprecated hidden alias for `undo module`; kept for backwards compatibility")
  .option("-y, --yes", "skip the confirmation prompt")
  .action(async (name, opts) => {
    console.error(pc.yellow("`remove module` is now `undo module` — running that instead."));
    try {
      await undoModule(name, { yes: opts.yes });
    } catch (err) {
      fail(err);
    }
  });

// runTopMenu is bare `go-scaffold` with no arguments at all — the exact
// command name is the one thing people forget, so give the same "ask, then
// delegate" menu `add` and `generate` already give when run bare, instead of
// Commander's static help text (which lists commands but never lets you act
// on one).
//
// Deliberately NOT a .action() on the root command: giving the root an action
// makes it callable, which turns a mistyped subcommand into "too many
// arguments. Expected 0 arguments but got 2: ad, auth" instead of Commander's
// "unknown command 'ad' (Did you mean add?)". Branching on argv keeps the
// menu and keeps that error.
async function runTopMenu(): Promise<void> {
  // Every entry but "create" needs a project. Offering them outside one buys
  // two selects and then the same error — so say it once, up front, and only
  // offer what can actually run here.
  const inProject = isProjectDir(process.cwd());
  const target = inProject
    ? await select({
        message: "What do you want to do?",
        choices: [
          { name: "Create a new project", value: "create" },
          { name: "Generate (module/method/migration in an existing project)", value: "generate" },
          { name: "Configure project generation defaults", value: "config" },
          { name: "Add (auth/worker/rbac/observability in an existing project)", value: "add" },
          { name: "Undo a generated module", value: "undo" },
        ],
      })
    : ((console.log(pc.dim(`${process.cwd()} isn't a go-scaffold project — only "create" can run here.\n`)), "create") as string);
  if (target === "create") {
    await createProject(undefined, {});
  } else if (target === "generate") {
    await runGenerateWizard();
  } else if (target === "config") {
    await configureProject();
  } else if (target === "add") {
    await runAddWizard();
  } else {
    await undoModule(undefined, {});
  }
}

if (process.argv.length <= 2) {
  runTopMenu().catch(fail);
} else {
  program.parseAsync(process.argv);
}
