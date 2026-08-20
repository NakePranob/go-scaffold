import { assertInteractive, confirm, input } from "./interactive";
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

// A flag the caller already passed is an answer, so the wizard takes it instead
// of asking again — asking would offer to overrule what they just said, and the
// old behaviour (ignore the flag, ask with the default pre-selected) meant
// `create x --no-docker` scaffolded Docker for anyone who hit Enter.
export interface CreateWizardPreset {
  docker?: boolean;
  openapiDocs?: boolean;
  observability?: boolean;
  apiPrefix?: string;
}

export async function runCreateWizard(preset: CreateWizardPreset = {}): Promise<CreateWizardResult> {
  // The closing "create with these settings?" is asked however many answers
  // arrived as flags, so this wizard always needs a terminal — say so before
  // printing a header for questions that are never going to appear.
  assertInteractive();
  console.log("\nConfigure your project:\n");

  const docker =
    preset.docker ??
    (await confirm({
      message: "Include Docker Compose (local Postgres)?",
      default: true,
    }));
  const openapiDocs =
    preset.openapiDocs ??
    (await confirm({
      message: "Include hand-written OpenAPI docs (docs/openapi.yaml, whole docs/ tree served at /docs)?",
      default: true,
    }));
  const observability =
    preset.observability ??
    (await confirm({
      message: "Add metrics + tracing (Prometheus /metrics, OpenTelemetry over OTLP/HTTP for Gin + GORM)?",
      default: false,
    }));
  // No default, so Enter means what an empty answer looks like it means. A
  // prefix is opt-in: it puts every route in the project behind a path segment
  // that is then fixed for the life of the project, which is not something to
  // acquire by not answering a question.
  const apiPrefixRaw =
    preset.apiPrefix ??
    (await input({
      message: "API route prefix — leave blank for none, or e.g. v1, api/v1:",
      validate: validateApiPrefix,
    }));
  const prefixCheck = validateApiPrefix(apiPrefixRaw);
  if (prefixCheck !== true) throw new Error(prefixCheck);
  const apiPrefix = normalizeApiPrefix(apiPrefixRaw);

  // Everything is listed whether it was asked or passed, so a flag never
  // reaches the project without the caller seeing the value it produced.
  const fromFlag = (passed: unknown) => (passed !== undefined ? " (from flag)" : "");
  console.log("\nSummary:");
  console.log(`  Docker + PostgreSQL: ${docker ? "yes" : "no"}${fromFlag(preset.docker)}`);
  console.log(`  OpenAPI docs: ${openapiDocs ? "yes" : "no"}${fromFlag(preset.openapiDocs)}`);
  console.log(`  Metrics + tracing: ${observability ? "yes" : "no"}${fromFlag(preset.observability)}`);
  console.log(`  Route prefix: ${apiPrefix ? `/${apiPrefix}` : "(none)"}${fromFlag(preset.apiPrefix)}`);

  const proceed = await confirm({ message: "\nCreate project with these settings?", default: true });
  if (!proceed) {
    throw new Error("project creation cancelled");
  }

  return { features: { docker, openapiDocs, observability }, apiPrefix };
}
