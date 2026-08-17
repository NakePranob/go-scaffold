import path from "path";
import fs from "fs-extra";
import pc from "picocolors";
import { readConfig, writeConfig } from "../utils/config";
import { applyTemplateEntries, gofmtTree } from "../utils/template-renderer";
import { OBSERVABILITY_FILES } from "../templates/observability-manifest";
import {
  patchConfigForObservability,
  patchDatabaseGoForObservability,
  patchEnvExampleForObservability,
  patchMainGoForObservability,
  patchOpenapiIndexForObservability,
} from "../utils/observability-patcher";

// addObservability scaffolds Prometheus metrics (GET /metrics) and
// OpenTelemetry tracing for Gin + GORM, wiring both into the files `create`
// already wrote. Opt-in and separate from `create`: most projects don't want
// to think about a collector on day one, and unlike worker/auth/rbac this
// touches files every project already has, so it has to patch rather than
// just add new ones. `create --observability` calls this immediately after
// scaffolding, so the two paths produce identical projects.
export async function addObservability(projectDir: string = process.cwd(), opts: { silent?: boolean } = {}): Promise<void> {
  const config = readConfig(projectDir);

  const telemetryGoPath = path.join(projectDir, "internal", "platform", "telemetry", "tracing.go");
  if (fs.existsSync(telemetryGoPath)) {
    throw new Error(`${telemetryGoPath} already exists — observability looks like it's already been added`);
  }

  await applyTemplateEntries(projectDir, OBSERVABILITY_FILES, { openapiDocs: config.features.openapiDocs });

  patchMainGoForObservability(path.join(projectDir, "cmd", "api", "main.go"), config.goModule, config.projectName);
  patchDatabaseGoForObservability(path.join(projectDir, "internal", "platform", "database", "database.go"), config.goModule);
  patchConfigForObservability(path.join(projectDir, "internal", "shared", "config", "config.go"));
  patchEnvExampleForObservability(path.join(projectDir, ".env.example"));

  const openapiPath = path.join(projectDir, "docs", "openapi.yaml");
  if (config.features.openapiDocs && fs.existsSync(openapiPath)) {
    patchOpenapiIndexForObservability(openapiPath);
  }

  gofmtTree(projectDir);

  writeConfig(projectDir, { ...config, features: { ...config.features, observability: true } });

  if (opts.silent) return;
  console.log(pc.green("\nadded internal/platform/telemetry/, internal/shared/middleware/{metrics,tracing}.go, and GET /metrics"));
  console.log("wired into cmd/api/main.go and internal/platform/database — every request and GORM query now gets a trace span");
  console.log(
    pc.dim(
      "\nnext: go mod tidy, then set OTEL_EXPORTER_OTLP_ENDPOINT to export traces (empty = tracing no-ops, /metrics works either way)\n" +
        "note: docs/architect/techstack.md and architecture.md were generated without this section if the project predates it — edit those by hand if you want them to mention it"
    )
  );
}
