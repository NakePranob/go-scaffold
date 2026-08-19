import path from "path";
import fs from "fs-extra";
import pc from "picocolors";
import { readConfig, writeConfig } from "../utils/config";
import { applyTemplateEntries, gofmtTree } from "../utils/template-renderer";
import { workerFiles } from "../templates/worker-manifest";
import { patchCiForRedis, patchComposeForRedis, patchConfigForWorker, patchMainGoForWorker } from "../utils/platform-patcher";
import { QueueBackend } from "../types";
import { assertStillParses, parseChecks } from "../utils/gocheck";
import { patchGoModRequires } from "../utils/gomod-patcher";
import { upgradeMailerToQueue } from "../utils/auth-patcher";

// addWorker scaffolds async job processing: the backend-neutral queue
// contract (platform/queue), one adapter for the chosen backing store, SMTP
// mail (platform/mail, with an email:send job as the one thing a fresh
// worker actually handles), and cmd/worker itself. Opt-in — most projects
// don't need a queue on day one, and an empty worker with no job kinds
// registered is a stranger scaffold than not having one.
export async function addWorker(backend: QueueBackend, projectDir: string = process.cwd()): Promise<void> {
  const config = readConfig(projectDir);

  const queueDir = path.join(projectDir, "internal", "platform", "queue");
  if (fs.existsSync(queueDir)) {
    throw new Error(`${queueDir} already exists — worker infrastructure looks like it's already been added`);
  }

  const parsedBefore = parseChecks(projectDir);

  const riverQueue = backend === "river";
  await applyTemplateEntries(projectDir, workerFiles(backend), { goModule: config.goModule, riverQueue });

  patchConfigForWorker(path.join(projectDir, "internal", "shared", "config", "config.go"), { redis: !riverQueue });
  if (!riverQueue) {
    patchMainGoForWorker(path.join(projectDir, "cmd", "api", "wiring.go"), config.goModule);
    patchComposeForRedis(path.join(projectDir, "docker-compose.yml"));
    patchCiForRedis(path.join(projectDir, ".github", "workflows", "ci.yml"));
  }

  // pinned to what this scaffold was written against — see gomod-patcher
  patchGoModRequires(
    path.join(projectDir, "go.mod"),
    riverQueue
      ? ["github.com/riverqueue/river v0.43.0", "github.com/riverqueue/river/riverdriver/riverdatabasesql v0.43.0"]
      : ["github.com/hibiken/asynq v0.26.0", "github.com/redis/go-redis/v9 v9.22.0"]
  );
  // auth added before the worker wired a synchronous mailer — now that there
  // is a queue, move it onto it
  upgradeMailerToQueue(path.join(projectDir, "cmd", "api", "wiring.go"), config.goModule, backend);

  patchEnvExample(path.join(projectDir, ".env.example"), { redis: !riverQueue });
  patchMakefile(path.join(projectDir, "Makefile"), { river: riverQueue });

  gofmtTree(projectDir);
  // parse-only: river/asynq aren't in go.mod until the user runs `go mod
  // tidy`, so `go vet` can't be the gate here.
  assertStillParses(projectDir, parsedBefore, `added worker (${backend})`);

  writeConfig(projectDir, { ...config, features: { ...config.features, worker: true, queue: backend } });

  console.log(pc.green(`\nadded internal/platform/{queue,mail}/ and cmd/worker/ (queue backend: ${backend})`));
  if (riverQueue) {
    console.log("jobs are rows in your Postgres — no extra service, and an enqueue inside tx.Do commits with it");
    console.log(pc.dim("\nnext: make river-migrate (creates River's tables), then make worker"));
  } else {
    console.log("wired Redis into cmd/api (readyz check) — cmd/api does not enqueue anything yet");
    console.log(pc.yellow("note: a Redis enqueue cannot join a database transaction — see the warning on queue.Asynq"));
    console.log(pc.dim("\nnext: make worker (separate terminal, or `make dev` runs both), then go build ./... to confirm"));
  }
}

function patchEnvExample(envExamplePath: string, opts: { redis: boolean }): void {
  if (!fs.existsSync(envExamplePath)) return;
  let content = fs.readFileSync(envExamplePath, "utf8");
  if (content.includes("SMTP_HOST")) return; // already added

  const redisBlock = opts.redis && !content.includes("REDIS_URL") ? "\nREDIS_URL=redis://localhost:6379/0\n" : "";

  content =
    content.replace(/\n?$/, "\n") +
    redisBlock +
    "\n# leave SMTP_HOST unset to log emails instead of sending them (dev default)\n" +
    "SMTP_HOST=\n" +
    "SMTP_PORT=587\n" +
    "SMTP_USERNAME=\n" +
    "SMTP_PASSWORD=\n" +
    "SMTP_FROM=no-reply@example.local\n";
  fs.writeFileSync(envExamplePath, content);
}

function patchMakefile(makefilePath: string, opts: { river: boolean }): void {
  if (!fs.existsSync(makefilePath)) return;
  let content = fs.readFileSync(makefilePath, "utf8");
  if (content.includes("\nworker:\n")) return; // already added

  content = content.replace(/^\.PHONY: /m, `.PHONY: dev worker${opts.river ? " river-migrate" : ""} `);

  // River keeps its own tables, versioned by River itself rather than by this
  // project's migrations/ directory — run its CLI once per database. Pinned
  // by nothing on purpose: it is a one-shot setup command, not a build input.
  const riverTarget = opts.river
    ? "\n# create River's job tables (run once per database, and after upgrading River)\n" +
      "river-migrate:\n" +
      "\t@[ -f $(ENV_FILE) ] && export $$(grep -v '^#' $(ENV_FILE) | sed -E 's/[[:space:]]+#.*$$//' | xargs); \\\n" +
      '\tgo run github.com/riverqueue/river/cmd/river@latest migrate-up --line main --database-url "$$DB_DSN"\n'
    : "";

  // Both load config exactly the way Makefile.hbs says every target does:
  // via $(ENV_FILE), and through the same sed that strips trailing comments.
  // Without it, .env.example's own `APP_ENV=development  # prod: production`
  // reaches `export` as a bare `#` and prints an error on every run.
  const loadEnv = "@[ -f $(ENV_FILE) ] && export $$(grep -v '^#' $(ENV_FILE) | sed -E 's/[[:space:]]+#.*$$//' | xargs);";

  const targets =
    "\n# run both API + worker in one terminal — Ctrl+C kills both\n" +
    "dev:\n" +
    `\t${loadEnv} \\\n` +
    "\t(trap 'kill 0' SIGINT SIGTERM; \\\n" +
    "\t go run ./cmd/api & \\\n" +
    "\t go run ./cmd/worker & \\\n" +
    "\t wait)\n" +
    "\n" +
    `# background worker for async job processing (email, ...) — requires ${opts.river ? "Postgres (make river-migrate first)" : "Redis"}.\n` +
    "# Use `make dev` to run both in one terminal, or run this in a separate one.\n" +
    "worker:\n" +
    `\t${loadEnv} go run ./cmd/worker\n` +
    riverTarget;

  // Function replacer: targets contains literal "$$" (Make's escape for a
  // shell "$") which String.replace would otherwise collapse to a single "$"
  // when the replacement is a plain string — turning "$$DB_DSN" into
  // "$DB_DSN" and silently handing the wrong value to every command below.
  content = content.replace(/\nbuild:/, () => `${targets}\nbuild:`);
  fs.writeFileSync(makefilePath, content);
}
