import path from "path";
import fs from "fs-extra";
import { ProjectConfig } from "../types";

const CONFIG_FILE = "go-scaffold.config.json";

export function configPath(projectDir: string): string {
  return path.join(projectDir, CONFIG_FILE);
}

export function writeConfig(projectDir: string, config: ProjectConfig): void {
  fs.writeJsonSync(configPath(projectDir), config, { spaces: 2 });
}

// readConfig falls back to detecting from go.mod when the config file is
// missing (e.g. a project scaffolded before this file existed).
export function readConfig(projectDir: string): ProjectConfig {
  const file = configPath(projectDir);
  if (fs.existsSync(file)) {
    return fs.readJsonSync(file) as ProjectConfig;
  }
  return detectConfig(projectDir);
}

function detectConfig(projectDir: string): ProjectConfig {
  const goModPath = path.join(projectDir, "go.mod");
  const mainGoPath = path.join(projectDir, "cmd", "api", "main.go");
  if (!fs.existsSync(goModPath)) {
    throw new Error(
      `no ${CONFIG_FILE} and no go.mod found in ${projectDir} — run this inside a go-scaffold project`
    );
  }
  // go.mod alone is just "some Go module". Without cmd/api/main.go there is
  // nothing to wire a module into, and every command would write its files
  // first and only then die on a missing main.go — a half-scaffolded
  // directory the user has to clean up by hand.
  if (!fs.existsSync(mainGoPath)) {
    throw new Error(
      `${projectDir} has a go.mod but no cmd/api/main.go — this looks like a plain Go module, not a go-scaffold project.\n` +
        `Run \`go-scaffold create <name>\` to start one.`
    );
  }
  const goMod = fs.readFileSync(goModPath, "utf8");
  const moduleMatch = goMod.match(/^module\s+(\S+)/m);
  const goModule = moduleMatch ? moduleMatch[1] : path.basename(projectDir);

  // parse the chosen prefix back out of `api := r.Group("/v1")`; an empty
  // group (`r.Group("")`) or no match at all means no prefix.
  //
  // Read from cmd/api/wiring.go where the composition root lives now, falling
  // back to main.go for projects scaffolded before it was split out — this is
  // the config-less path, so it is exactly the old projects that reach it.
  const wiringGoPath = path.join(projectDir, "cmd", "api", "wiring.go");
  const compositionRoot = fs.existsSync(wiringGoPath) ? wiringGoPath : mainGoPath;
  let apiPrefix = "";
  const groupMatch = fs.readFileSync(compositionRoot, "utf8").match(/api\s*:=\s*r\.Group\("\/?([a-z0-9/]*)"\)/);
  if (groupMatch) apiPrefix = groupMatch[1];

  // Every feature is detectable from the tree each `add` command creates, so
  // detect them all rather than reporting only docker/openapi. Leaving the
  // rest undefined made a config-less project a dead end: `add auth` refused
  // ("needs add worker first") while `add worker` also refused ("queue
  // already exists"), with no way out. Worse, the first `add` to succeed then
  // wrote a config that recorded the undetected features as absent.
  const has = (...segments: string[]) => fs.existsSync(path.join(projectDir, ...segments));
  const worker = has("internal", "platform", "queue");

  return {
    projectName: path.basename(projectDir),
    goModule,
    apiPrefix,
    features: {
      docker: has("docker-compose.yml"),
      openapiDocs: has("docs", "openapi.yaml"),
      worker,
      // which adapter file is present is what `add worker --queue` decided
      queue: !worker ? undefined : has("internal", "platform", "queue", "asynq.go") ? "asynq" : "river",
      auth: has("internal", "app", "user"),
      // which store `add auth` chose is readable from which implementation
      // file it wrote — same trick as the queue adapter above. Projects from
      // before the option existed have neither name and read as "redis",
      // which is what they in fact are.
      authStore: !has("internal", "app", "user")
        ? undefined
        : has("internal", "app", "user", "tokenstore_pg.go")
          ? "postgres"
          : "redis",
      rbac: has("internal", "app", "role"),
      observability: has("internal", "platform", "telemetry"),
    },
  };
}
