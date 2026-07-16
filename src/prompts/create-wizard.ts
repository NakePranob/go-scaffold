import { confirm, input } from "@inquirer/prompts";
import { validateApiPrefix, validateGoModulePath } from "../utils/naming";
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

export interface CreateWizardResult {
  features: ProjectFeatures;
  apiPrefix: string;
}

export async function runCreateWizard(): Promise<CreateWizardResult> {
  console.log("\nConfigure your project:\n");

  const docker = await confirm({
    message: "Include Docker Compose (local Postgres)?",
    default: true,
  });
  const openapiDocs = await confirm({
    message: "Include hand-written OpenAPI docs (docs/openapi.yaml, served at /openapi.yaml)?",
    default: true,
  });
  const apiPrefix = await input({
    message: "API route prefix (e.g. v1, api; leave blank for none):",
    default: "v1",
    validate: validateApiPrefix,
  });

  console.log("\nSummary:");
  console.log(`  Docker + PostgreSQL: ${docker ? "yes" : "no"}`);
  console.log(`  OpenAPI docs: ${openapiDocs ? "yes" : "no"}`);
  console.log(`  Route prefix: ${apiPrefix.trim() ? `/${apiPrefix.trim()}` : "(none)"}`);

  const proceed = await confirm({ message: "\nCreate project with these settings?", default: true });
  if (!proceed) {
    throw new Error("project creation cancelled");
  }

  return { features: { docker, openapiDocs }, apiPrefix: apiPrefix.trim() };
}
