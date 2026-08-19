import path from "path";
import fs from "fs-extra";
import pc from "picocolors";
import { readConfig, writeConfig } from "../utils/config";
import { applyTemplateEntries, getTemplatesRoot, gofmtTree, renderString } from "../utils/template-renderer";
import { ProjectConfig } from "../types";
import { OBSERVABILITY_FILES } from "../templates/observability-manifest";
import {
  patchConfigForObservability,
  patchDatabaseGoForObservability,
  patchEnvExampleForObservability,
  patchMainGoForObservability,
  patchOpenapiIndexForObservability,
} from "../utils/observability-patcher";
import { assertStillParses, parseChecks } from "../utils/gocheck";
import { patchGoModRequires } from "../utils/gomod-patcher";

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
  const staleDocs = refreshArchitectDocs(projectDir, config);
  writeConfig(projectDir, { ...config, features: { ...config.features, observability: true } });

  if (opts.silent) return;
  console.log(pc.green("\nadded internal/platform/telemetry/, internal/shared/middleware/{metrics,tracing}.go, and GET /metrics"));
  console.log("wired into cmd/api/wiring.go and internal/platform/database — every request and GORM query now gets a trace span");
  if (staleDocs.length) {
    // Deliberately not "you edited these". The comparison is a whole-file
    // match against today's template, and techstack.md embeds pinned
    // dependency versions — so every release that bumps one makes every
    // project scaffolded before it look edited. Which is exactly the
    // population this function exists for.
    console.log(
      pc.yellow(
        `\nnote: couldn't safely rewrite ${staleDocs.join(" and ")} — ` +
          `${staleDocs.length > 1 ? "they don't" : "it doesn't"} match what this go-scaffold\n` +
          `  would have generated, so ${staleDocs.length > 1 ? "they were" : "it was"} left alone rather than overwriting your edits.\n` +
          `  ${staleDocs.length > 1 ? "They still describe" : "It still describes"} this project as having no metrics or tracing; update by hand.`
      )
    );
  }
  console.log(
    pc.dim(
      "\nnext: go mod tidy, then set OTEL_EXPORTER_OTLP_ENDPOINT to export traces (empty = tracing no-ops, /metrics works either way)"
    )
  );
}

// The architecture docs gate their observability sections on a `create`-time
// flag, so adding the feature afterwards used to leave techstack.md saying
// `disabled` and architecture.md missing the section entirely — while the
// README promises `create --observability` and this command produce the same
// project.
//
// Re-rendering from the templates rather than string-patching keeps the prose
// in one place (the .hbs), but would also silently discard a user's edits. So
// it first renders what the file *should* look like today, with observability
// still off: only a byte-for-byte match proves nobody has touched it. Returns
// the docs it declined to overwrite, for the caller to warn about.
function refreshArchitectDocs(projectDir: string, config: ProjectConfig): string[] {
  const docs = [
    { template: "create/features/docs/architecture.md.hbs", output: path.join("docs", "architect", "architecture.md") },
    { template: "create/features/docs/techstack.md.hbs", output: path.join("docs", "architect", "techstack.md") },
  ];
  // only what the two templates actually reference — projectName, apiPrefix
  // and the feature flags
  const base = { projectName: config.projectName, apiPrefix: config.apiPrefix, ...config.features };

  const root = getTemplatesRoot();
  const skipped: string[] = [];
  for (const doc of docs) {
    const outputPath = path.join(projectDir, doc.output);
    if (!fs.existsSync(outputPath)) continue;
    const source = fs.readFileSync(path.join(root, doc.template), "utf8");
    // compare with line endings normalised — a Windows checkout with
    // core.autocrlf=true would otherwise never match, and the feature would
    // silently never fire there
    const onDisk = lf(fs.readFileSync(outputPath, "utf8"));
    if (onDisk !== lf(renderString(source, { ...base, observability: false }))) {
      skipped.push(doc.output);
      continue;
    }
    fs.writeFileSync(outputPath, renderString(source, { ...base, observability: true }));
  }
  return skipped;
}

function lf(text: string): string {
  return text.replace(/\r\n/g, "\n");
}
