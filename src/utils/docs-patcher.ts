import path from "path";
import fs from "fs-extra";
import { ProjectConfig, ProjectFeatures } from "../types";
import { toDbName } from "./naming";
import { getTemplatesRoot, renderString } from "./template-renderer";

const PROJECT_DOCS = [
  { template: "create/base/README.md.hbs", output: "README.md" },
  { template: "create/features/docs/architecture.md.hbs", output: path.join("docs", "architect", "architecture.md") },
  { template: "create/features/docs/techstack.md.hbs", output: path.join("docs", "architect", "techstack.md") },
];

/**
 * Refresh generated project docs after an incremental feature is installed.
 *
 * A generated doc is only safe to rewrite when its bytes still match the
 * version rendered from the project's current config. This keeps feature
 * commands from destroying a maintainer's edits while still preventing the
 * common stale-doc state where config says a feature is enabled but README or
 * architect docs still describe the base skeleton.
 */
export function refreshProjectDocs(
  projectDir: string,
  config: ProjectConfig,
  featureOverrides: Partial<ProjectFeatures>,
): string[] {
  const beforeFeatures = { ...config.features };
  const afterFeatures = { ...beforeFeatures, ...featureOverrides };
  const beforeContext = {
    projectName: config.projectName,
    dbName: toDbName(config.projectName),
    apiPrefix: config.apiPrefix,
    ...config.architecture,
    ...beforeFeatures,
  };
  const afterContext = {
    projectName: config.projectName,
    dbName: toDbName(config.projectName),
    apiPrefix: config.apiPrefix,
    ...config.architecture,
    ...afterFeatures,
  };
  const root = getTemplatesRoot();
  const skipped: string[] = [];

  for (const doc of PROJECT_DOCS) {
    const outputPath = path.join(projectDir, doc.output);
    if (!fs.existsSync(outputPath)) continue;

    const source = fs.readFileSync(path.join(root, doc.template), "utf8");
    const onDisk = normalizeLineEndings(fs.readFileSync(outputPath, "utf8"));
    const expectedBefore = normalizeLineEndings(renderString(source, beforeContext));
    if (onDisk !== expectedBefore) {
      skipped.push(doc.output);
      continue;
    }

    fs.writeFileSync(outputPath, renderString(source, afterContext));
  }

  return skipped;
}

export function docsRefreshWarning(skipped: string[], feature: string): string {
  if (skipped.length === 0) return "";
  const files = skipped.join(", ");
  return `\nwarning: ${files} did not match the generated version, so ${feature} left them untouched — update them by hand`;
}

function normalizeLineEndings(text: string): string {
  return text.replace(/\r\n/g, "\n");
}
