import { confirm, input } from "@inquirer/prompts";
import { validateGoModulePath } from "../utils/naming";
import { ProjectFeatures } from "../types";

export async function promptProjectName(): Promise<string> {
  const name = await input({
    message: "Project name:",
    validate: (value) => {
      if (!value.trim()) return "project name is required";
      return validateGoModulePath(value.trim());
    },
  });
  return name.trim();
}

export async function runCreateWizard(): Promise<ProjectFeatures> {
  console.log("\nConfigure your project:\n");

  const docker = await confirm({
    message: "Include Docker Compose (local Postgres)?",
    default: true,
  });
  const openapiDocs = await confirm({
    message: "Include hand-written OpenAPI docs (docs/openapi.yaml, served at /openapi.yaml)?",
    default: true,
  });
  const versioning = await confirm({
    message: "Enable folder-based domain versioning (internal/app/v1/<domain>)?",
    default: false,
  });

  console.log("\nSummary:");
  console.log(`  Docker + PostgreSQL: ${docker ? "yes" : "no"}`);
  console.log(`  OpenAPI docs: ${openapiDocs ? "yes" : "no"}`);
  console.log(`  Module versioning: ${versioning ? "yes (default: v1)" : "no"}`);

  const proceed = await confirm({ message: "\nCreate project with these settings?", default: true });
  if (!proceed) {
    throw new Error("project creation cancelled");
  }

  return { docker, openapiDocs, versioning };
}
