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
  if (!fs.existsSync(goModPath)) {
    throw new Error(
      `no ${CONFIG_FILE} and no go.mod found in ${projectDir} — run this inside a go-scaffold project`
    );
  }
  const goMod = fs.readFileSync(goModPath, "utf8");
  const moduleMatch = goMod.match(/^module\s+(\S+)/m);
  const goModule = moduleMatch ? moduleMatch[1] : path.basename(projectDir);

  // parse the chosen prefix back out of `api := r.Group("/v1")` in main.go;
  // an empty group (`r.Group("")`) or no match at all means no prefix.
  let apiPrefix = "";
  const mainGoPath = path.join(projectDir, "cmd", "api", "main.go");
  if (fs.existsSync(mainGoPath)) {
    const groupMatch = fs.readFileSync(mainGoPath, "utf8").match(/api\s*:=\s*r\.Group\("\/?([a-z0-9/]*)"\)/);
    if (groupMatch) apiPrefix = groupMatch[1];
  }

  return {
    projectName: path.basename(projectDir),
    goModule,
    apiPrefix,
    features: {
      docker: fs.existsSync(path.join(projectDir, "docker-compose.yml")),
      openapiDocs: fs.existsSync(path.join(projectDir, "docs", "openapi.yaml")),
    },
  };
}
