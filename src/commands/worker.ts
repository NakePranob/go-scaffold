import path from "path";
import fs from "fs-extra";
import pc from "picocolors";
import { readConfig, writeConfig } from "../utils/config";
import { applyTemplateEntries, gofmtTree } from "../utils/template-renderer";
import { WORKER_FILES } from "../templates/worker-manifest";
import { patchConfigForWorker, patchMainGoForWorker } from "../utils/platform-patcher";

// addWorker scaffolds the async task processing subsystem: Redis
// (platform/cache), Asynq client/server (platform/queue), SMTP mail
// (platform/mail, with an email:send task type as the one thing the fresh
// worker actually handles), and cmd/worker itself. Opt-in — most projects
// don't need a queue on day one, and an empty worker with no task types
// registered is a stranger scaffold than just not having one.
export async function addWorker(projectDir: string = process.cwd()): Promise<void> {
  const config = readConfig(projectDir);

  const queueDir = path.join(projectDir, "internal", "platform", "queue");
  if (fs.existsSync(queueDir)) {
    throw new Error(`${queueDir} already exists — worker infrastructure looks like it's already been added`);
  }

  await applyTemplateEntries(projectDir, WORKER_FILES, { goModule: config.goModule });

  patchConfigForWorker(path.join(projectDir, "internal", "shared", "config", "config.go"));
  patchMainGoForWorker(path.join(projectDir, "cmd", "api", "main.go"), config.goModule);

  patchEnvExample(path.join(projectDir, ".env.example"));
  patchMakefile(path.join(projectDir, "Makefile"));

  gofmtTree(projectDir);

  writeConfig(projectDir, { ...config, features: { ...config.features, worker: true } });

  console.log(pc.green("\nadded internal/platform/{cache,queue,mail}/ and cmd/worker/"));
  console.log("wired Redis into cmd/api (readyz check) — cmd/api does not enqueue anything yet");
  console.log(pc.dim("\nnext: make worker (separate terminal, or `make dev` runs both), then go build ./... to confirm"));
}

function patchEnvExample(envExamplePath: string): void {
  if (!fs.existsSync(envExamplePath)) return;
  let content = fs.readFileSync(envExamplePath, "utf8");
  if (content.includes("REDIS_URL")) return; // already added

  content =
    content.replace(/\n?$/, "\n") +
    "\nREDIS_URL=redis://localhost:6379/0\n" +
    "\n# leave SMTP_HOST unset to log emails instead of sending them (dev default)\n" +
    "SMTP_HOST=\n" +
    "SMTP_PORT=587\n" +
    "SMTP_USERNAME=\n" +
    "SMTP_PASSWORD=\n" +
    "SMTP_FROM=no-reply@example.local\n";
  fs.writeFileSync(envExamplePath, content);
}

function patchMakefile(makefilePath: string): void {
  if (!fs.existsSync(makefilePath)) return;
  let content = fs.readFileSync(makefilePath, "utf8");
  if (content.includes("\nworker:\n")) return; // already added

  content = content.replace(/^\.PHONY: /m, ".PHONY: dev worker ");

  const targets =
    "\n# run both API + worker in one terminal — Ctrl+C kills both\n" +
    "dev:\n" +
    "\t@[ -f .env ] && export $$(grep -v '^#' .env | xargs); \\\n" +
    "\t(trap 'kill 0' SIGINT SIGTERM; \\\n" +
    "\t go run ./cmd/api & \\\n" +
    "\t go run ./cmd/worker & \\\n" +
    "\t wait)\n" +
    "\n" +
    "# background worker for async task processing (email, ...) — requires Redis.\n" +
    "# Use `make dev` to run both in one terminal, or run this in a separate one.\n" +
    "worker:\n" +
    "\t@[ -f .env ] && export $$(grep -v '^#' .env | xargs); go run ./cmd/worker\n";

  content = content.replace(/\nbuild:/, `${targets}\nbuild:`);
  fs.writeFileSync(makefilePath, content);
}
