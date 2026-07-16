import path from "path";
import fs from "fs-extra";
import pc from "picocolors";
import { applyTemplateEntries, gofmtTree } from "../utils/template-renderer";
import { CREATE_MANIFEST } from "../templates/create-manifest";
import { writeConfig } from "../utils/config";
import { assertValidGoModulePath, toDbName } from "../utils/naming";
import { promptProjectName, runCreateWizard } from "../prompts/create-wizard";
import { ProjectFeatures } from "../types";

export interface CreateOptions {
  defaults?: boolean;
  docker?: boolean;
  openapiDocs?: boolean;
  versioning?: boolean;
}

export async function createProject(rawName: string | undefined, opts: CreateOptions): Promise<void> {
  const trimmed = (rawName ?? (await promptProjectName())).trim();
  if (!trimmed) throw new Error("project name is required");
  assertValidGoModulePath(trimmed);

  const goModule = trimmed;
  const projectName = trimmed.includes("/") ? trimmed.split("/").pop()! : trimmed;
  const projectDir = path.resolve(process.cwd(), projectName);

  if (fs.existsSync(projectDir) && fs.readdirSync(projectDir).length > 0) {
    throw new Error(`${projectDir} already exists and is not empty`);
  }

  const features: ProjectFeatures = opts.defaults
    ? {
        docker: opts.docker ?? true,
        openapiDocs: opts.openapiDocs ?? true,
        versioning: opts.versioning ?? false,
      }
    : await runCreateWizard();

  const context = {
    projectName,
    goModule,
    dbName: toDbName(projectName),
    ...features,
  };

  await fs.ensureDir(projectDir);
  await applyTemplateEntries(projectDir, CREATE_MANIFEST, context);
  gofmtTree(projectDir);
  writeConfig(projectDir, { projectName, goModule, features });

  console.log(pc.green(`\ncreated ${projectName}/`));
  console.log(`\ncd ${projectName}`);
  if (features.docker) console.log(`make docker-up`);
  console.log(`go mod tidy`);
  console.log(`make run`);
  console.log(pc.dim(`\nadd your first domain: go-scaffold generate module <name>`));
}
