import { confirm, input } from "@inquirer/prompts";
import { normalizeApiPrefix, validateApiPrefix, validateGoModulePath } from "../utils/naming";
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
    message: "Include hand-written OpenAPI docs (docs/openapi.yaml, whole docs/ tree served at /docs)?",
    default: true,
  });
  const observability = await confirm({
    message: "Add metrics + tracing (Prometheus /metrics, OpenTelemetry over OTLP/HTTP for Gin + GORM)?",
    default: false,
  });
  // No default, so Enter means what an empty answer looks like it means. A
  // prefix is opt-in: it puts every route in the project behind a path segment
  // that is then fixed for the life of the project, which is not something to
  // acquire by not answering a question.
  const apiPrefixRaw = await input({
    message: "API route prefix — leave blank for none, or e.g. v1, api/v1:",
    validate: validateApiPrefix,
  });
  const apiPrefix = normalizeApiPrefix(apiPrefixRaw);

  console.log("\nSummary:");
  console.log(`  Docker + PostgreSQL: ${docker ? "yes" : "no"}`);
  console.log(`  OpenAPI docs: ${openapiDocs ? "yes" : "no"}`);
  console.log(`  Metrics + tracing: ${observability ? "yes" : "no"}`);
  console.log(`  Route prefix: ${apiPrefix ? `/${apiPrefix}` : "(none)"}`);

  const proceed = await confirm({ message: "\nCreate project with these settings?", default: true });
  if (!proceed) {
    throw new Error("project creation cancelled");
  }

  return { features: { docker, openapiDocs, observability }, apiPrefix };
}
