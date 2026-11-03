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
  patchWorkerGoForObservability,
  patchOpenapiIndexForObservability,
} from "../utils/observability-patcher";
import { assertStillParses, parseChecks } from "../utils/gocheck";
import { patchGoModRequires } from "../utils/gomod-patcher";
import { docsRefreshWarning, refreshProjectDocs } from "../utils/docs-patcher";

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

  const parsedBefore = parseChecks(projectDir);

  await applyTemplateEntries(projectDir, OBSERVABILITY_FILES, { openapiDocs: config.features.openapiDocs });

  patchMainGoForObservability(path.join(projectDir, "cmd", "api", "wiring.go"), config.goModule, config.projectName);
  if (config.features.worker) {
    patchWorkerGoForObservability(path.join(projectDir, "cmd", "worker", "main.go"), config.goModule, config.projectName);
  }
  patchDatabaseGoForObservability(path.join(projectDir, "internal", "platform", "database", "database.go"), config.goModule);
  patchConfigForObservability(path.join(projectDir, "internal", "shared", "config", "config.go"));
  patchGoModRequires(path.join(projectDir, "go.mod"), [
    "github.com/prometheus/client_golang v1.24.1",
    "go.opentelemetry.io/otel v1.45.0",
    "go.opentelemetry.io/otel/exporters/otlp/otlptrace/otlptracehttp v1.45.0",
    "go.opentelemetry.io/otel/sdk v1.45.0",
    "go.opentelemetry.io/otel/trace v1.45.0",
  ]);
  patchEnvExampleForObservability(path.join(projectDir, ".env.example"));

  const openapiPath = path.join(projectDir, "docs", "openapi.yaml");
  if (config.features.openapiDocs && fs.existsSync(openapiPath)) {
    patchOpenapiIndexForObservability(openapiPath);
  }

  gofmtTree(projectDir);
  // parse-only: the otel/prometheus imports this adds aren't in go.mod until
  // the `go mod tidy` printed below, so `go vet` can't be the gate here.
  assertStillParses(projectDir, parsedBefore, "added observability");

  // After the gate, next to writeConfig: these are .md files, so the parse
  // check has no reason to guard them, and a throw from it used to strand the
  // docs saying `enabled` while the config it never reached still said false —
  // a disagreement no later command could converge, since the "already added"
  // guard then blocks a re-run.
  const staleDocs = refreshProjectDocs(projectDir, config, { observability: true });
  writeConfig(projectDir, { ...config, features: { ...config.features, observability: true } });

  if (opts.silent) return;
  console.log(pc.green("\nadded internal/platform/telemetry/, internal/shared/middleware/{metrics,tracing}.go, and GET /metrics"));
  console.log("wired into cmd/api/wiring.go and internal/platform/database — every request and GORM query cmd/api makes now gets a trace span");
  if (config.features.worker) {
    console.log("cmd/worker initializes its own tracer and traces generated mail jobs; it does not expose /metrics");
  }
  if (staleDocs.length) console.log(pc.yellow(docsRefreshWarning(staleDocs, "add observability")));
  console.log(
    pc.dim(
      "\nnext: go mod tidy, then set OTEL_EXPORTER_OTLP_ENDPOINT to export traces (empty = tracing no-ops, /metrics works either way)"
    )
  );
}
