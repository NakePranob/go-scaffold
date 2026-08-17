import { TemplateEntry } from "../utils/template-renderer";

// output paths are relative to the project root
export const OBSERVABILITY_FILES: TemplateEntry[] = [
  {
    template: "create/features/observability/middleware/metrics.go.hbs",
    output: "internal/shared/middleware/metrics.go",
  },
  {
    template: "create/features/observability/middleware/tracing.go.hbs",
    output: "internal/shared/middleware/tracing.go",
  },
  {
    template: "create/features/observability/platform/telemetry/tracing.go.hbs",
    output: "internal/platform/telemetry/tracing.go",
  },
  // only meaningful once there's an openapi.yaml to $ref it from
  {
    template: "create/features/docs/observability/metrics.yaml.hbs",
    output: "docs/observability/metrics.yaml",
    when: (ctx) => ctx.openapiDocs,
  },
];
