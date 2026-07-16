import path from "path";
import nodeFs from "fs";
import fs from "fs-extra";
import { execFileSync } from "child_process";
import Handlebars from "handlebars";

Handlebars.registerHelper("eq", (a, b) => a === b);

export function getTemplatesRoot(): string {
  const candidates = [
    path.join(__dirname, "..", "..", "templates"),
    path.join(__dirname, "..", "..", "..", "templates"),
  ];
  const resolved = candidates.find((candidate) =>
    nodeFs.existsSync(path.join(candidate, "create", "base", "go.mod.hbs"))
  );
  if (!resolved) {
    throw new Error("unable to locate templates directory");
  }
  return resolved;
}

export function renderString(source: string, context: object): string {
  return Handlebars.compile(source, { noEscape: true })(context);
}

export interface TemplateEntry {
  /** path relative to templates/, e.g. "create/base/go.mod.hbs" */
  template: string;
  /** path relative to the project root, e.g. "go.mod" */
  output: string;
  when?: (ctx: any) => boolean;
}

export async function applyTemplateEntries(
  projectRoot: string,
  entries: TemplateEntry[],
  context: object
): Promise<void> {
  const root = getTemplatesRoot();
  for (const entry of entries) {
    if (entry.when && !entry.when(context)) continue;
    const source = await fs.readFile(path.join(root, entry.template), "utf8");
    const rendered = renderString(source, context);
    const outputPath = path.join(projectRoot, entry.output);
    await fs.ensureDir(path.dirname(outputPath));
    await fs.writeFile(outputPath, rendered);
  }
}

// gofmt the whole project tree; a missing gofmt (no local Go toolchain) is
// non-fatal — generated files are already hand-formatted templates.
export function gofmtTree(projectRoot: string): void {
  try {
    execFileSync("gofmt", ["-w", "."], { cwd: projectRoot, stdio: "ignore" });
  } catch {
    // ponytail: no Go toolchain on this machine, skip formatting
  }
}
