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
  // "none", not blank. There is a default, and inquirer returns the default
  // when the answer is empty — so the old "leave blank for none" hint asked
  // for the one input that could never produce it, and pressing Enter to get
  // "no prefix" silently produced /v1 instead.
  //
  // The literal cost is that a project cannot be prefixed with /none. Nobody
  // has ever wanted that; several people have wanted no prefix.
  const NO_PREFIX = "none";
  const apiPrefixRaw = await input({
    message: `API route prefix, e.g. v1 or api/v1 — type "${NO_PREFIX}" for no prefix:`,
    default: "v1",
    validate: (value) => (value.trim().toLowerCase() === NO_PREFIX ? true : validateApiPrefix(value)),
  });
  const apiPrefix =
    apiPrefixRaw.trim().toLowerCase() === NO_PREFIX ? "" : normalizeApiPrefix(apiPrefixRaw);

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
