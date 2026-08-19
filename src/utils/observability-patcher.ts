import fs from "fs-extra";
import { insertBeforeMarkerOnce } from "./marker-patch";

const IMPORT_MARKER = "// go-scaffold:imports";
const PLATFORM_INIT_MARKER = "// go-scaffold:platform-init";
const EXTRA_ROUTES_MARKER = "// go-scaffold:extra-routes";
const CONFIG_FIELDS_MARKER = "// go-scaffold:config-fields";
const CONFIG_LOAD_MARKER = "// go-scaffold:config-load";
const OPENAPI_PATHS_MARKER = "# go-scaffold:paths";

// The exact line `create` renders — matched literally rather than through a
// marker because it's a single call in the middle of other middleware, not a
// standalone line a marker comment can sit next to.
const USE_LINE =
  "r.Use(gin.Recovery(), middleware.CORS(cfg.CORSAllowedOrigins), middleware.RequestID(), middleware.Logger(logger), middleware.Error(!cfg.IsProd()))";

// patchMainGoForObservability wires telemetry init, the tracing/metrics
// middleware, and the /metrics route into cmd/api/main.go — the same
// text-marker approach every other `add` command uses, since main.go is a
// real file a human may have already edited by the time this runs, not a
// template rendered fresh.
export function patchMainGoForObservability(mainGoPath: string, goModule: string, projectName: string): void {
  let content = fs.readFileSync(mainGoPath, "utf8");

  const telemetryImport = `"${goModule}/internal/platform/telemetry"`;
  content = insertBeforeMarkerOnce(content, IMPORT_MARKER, telemetryImport, telemetryImport);
  const promhttpImport = `"github.com/prometheus/client_golang/prometheus/promhttp"`;
  content = insertBeforeMarkerOnce(content, IMPORT_MARKER, promhttpImport, promhttpImport);

  // telemetry.go's GORM plugin looks up otel.Tracer() fresh on every query
  // rather than once at registration, so it doesn't matter that this runs
  // after database.Open has already called db.Use(NewGormPlugin()) — no
  // query happens between here and the server actually accepting traffic.
  const initBlock = [
    `shutdownTelemetry, err := telemetry.Init(context.Background(), "${projectName}", cfg.OTELExporterEndpoint)`,
    "if err != nil {",
    '\tlogger.Error("init telemetry", "error", err)',
    "\tos.Exit(1)",
    "}",
    "defer func() { _ = shutdownTelemetry(context.Background()) }()",
  ].join("\n");
  content = insertBeforeMarkerOnce(content, PLATFORM_INIT_MARKER, initBlock, "shutdownTelemetry, err := telemetry.Init(");

  if (!content.includes(USE_LINE)) {
    throw new Error(
      "cmd/api/main.go's r.Use(...) call doesn't match the text this command expects — " +
        "it looks like it's been hand-edited. Add middleware.Metrics() and middleware.Tracing(\"<project>\") to it yourself."
    );
  }
  const newUseLine = `${USE_LINE.slice(0, -1)}, middleware.Metrics(), middleware.Tracing("${projectName}"))`;
  content = content.replace(USE_LINE, () => newUseLine);

  // Not gated on APP_ENV the way /docs is: production is exactly where you
  // want a scrape target, and Prometheus reaches it in-cluster. It is still
  // unauthenticated and does disclose your route list and traffic shape, so
  // block /metrics at the ingress rather than publishing it to the internet.
  const metricsRoute = 'r.GET("/metrics", gin.WrapH(promhttp.Handler()))';
  const metricsBlock = [
    "// Unauthenticated on purpose (Prometheus scrapes it in-cluster) — block",
    "// /metrics at your ingress so it isn't reachable from the internet.",
    metricsRoute,
  ].join("\n");
  content = insertBeforeMarkerOnce(content, EXTRA_ROUTES_MARKER, metricsBlock, metricsRoute);

  fs.writeFileSync(mainGoPath, content);
}

// patchDatabaseGoForObservability wires the GORM OpenTelemetry plugin into
// database.Open, so every query gets a span alongside the HTTP request it
// came from.
export function patchDatabaseGoForObservability(databaseGoPath: string, goModule: string): void {
  let content = fs.readFileSync(databaseGoPath, "utf8");

  const telemetryImport = `"${goModule}/internal/platform/telemetry"`;
  content = insertBeforeMarkerOnce(content, IMPORT_MARKER, telemetryImport, telemetryImport);

  const pluginBlock = ["if err := db.Use(telemetry.NewGormPlugin()); err != nil {", "\treturn nil, err", "}"].join("\n");
  content = insertBeforeMarkerOnce(content, PLATFORM_INIT_MARKER, pluginBlock, "if err := db.Use(telemetry.NewGormPlugin())");

  fs.writeFileSync(databaseGoPath, content);
}

// patchConfigForObservability adds OTELExporterEndpoint to Config and its
// env() load — the same marker-based approach patchConfigForWorker uses.
export function patchConfigForObservability(configGoPath: string): void {
  let content = fs.readFileSync(configGoPath, "utf8");
  content = insertBeforeMarkerOnce(content, CONFIG_FIELDS_MARKER, "OTELExporterEndpoint string", "OTELExporterEndpoint");
  content = insertBeforeMarkerOnce(
    content,
    CONFIG_LOAD_MARKER,
    'OTELExporterEndpoint: env("OTEL_EXPORTER_OTLP_ENDPOINT", ""),',
    'env("OTEL_EXPORTER_OTLP_ENDPOINT"'
  );
  fs.writeFileSync(configGoPath, content);
}

// patchEnvExampleForObservability appends OTEL_EXPORTER_OTLP_ENDPOINT —
// .env.example has no marker infrastructure of its own, so this follows the
// same append-once pattern as add worker/add auth's env patchers.
export function patchEnvExampleForObservability(envExamplePath: string): void {
  if (!fs.existsSync(envExamplePath)) return;
  const content = fs.readFileSync(envExamplePath, "utf8");
  if (content.includes("OTEL_EXPORTER_OTLP_ENDPOINT")) return;
  fs.writeFileSync(
    envExamplePath,
    content.replace(/\n?$/, "\n") +
      "\n# OTLP/HTTP endpoint for trace export (e.g. localhost:4318) — empty disables\n" +
      "# tracing entirely: no exporter is created, no network calls are made\n" +
      "OTEL_EXPORTER_OTLP_ENDPOINT=\n"
  );
}

// patchOpenapiIndexForObservability wires /metrics into docs/openapi.yaml.
// Not routed through patchOpenapiIndexRaw (used for auth/rbac's paths):
// /metrics is registered directly on the router like /livez and /readyz, not
// under the api prefix group, so it must never be prefixed.
export function patchOpenapiIndexForObservability(openapiPath: string): void {
  let content = fs.readFileSync(openapiPath, "utf8");
  const block = "/metrics:\n  $ref: './observability/metrics.yaml'";
  content = insertBeforeMarkerOnce(content, OPENAPI_PATHS_MARKER, block, "/metrics:");
  fs.writeFileSync(openapiPath, content);
}
