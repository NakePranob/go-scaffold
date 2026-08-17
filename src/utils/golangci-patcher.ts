import fs from "fs-extra";
import { insertBeforeMarkerOnce } from "./marker-patch";

const DEPGUARD_MARKER = "# go-scaffold:depguard-rules";

function ruleName(pkg: string): string {
  return `domain-isolation-${pkg}`;
}

// depguardRule is the per-domain boundary rule. It has to be per-domain
// because depguard matches import paths as static prefixes with no idea which
// domain a file belongs to: a single `deny: internal/app` rule would also
// reject `order` importing its own `order/model`. Scoping with `files:` and
// allowing exactly this domain's own path gives "may import myself, may not
// import a sibling".
//
// Written with no leading indentation — insertBeforeMarker re-indents the
// whole block to match the marker's own column.
function depguardRule(goModule: string, pkg: string): string {
  return [
    `${ruleName(pkg)}:`,
    `  list-mode: lax`,
    `  files:`,
    `    - "**/internal/app/${pkg}/**"`,
    `  allow:`,
    `    - "${goModule}/internal/app/${pkg}"`,
    `  deny:`,
    `    - pkg: "${goModule}/internal/app"`,
    `      desc: >-`,
    `        a domain must not import another domain directly — declare a`,
    `        consumer-side interface for what you need and let`,
    `        cmd/api/main.go wire the concrete service in`,
    `        (docs/architect/patterns.md)`,
  ].join("\n");
}

// patchGolangciForModule adds this domain's boundary rule. No-op on a project
// whose .golangci.yml predates the marker (or was replaced wholesale) — a
// missing lint rule must never fail code generation.
export function patchGolangciForModule(golangciPath: string, goModule: string, pkg: string): void {
  if (!fs.existsSync(golangciPath)) return;
  const content = fs.readFileSync(golangciPath, "utf8");
  if (!content.includes(DEPGUARD_MARKER)) return;

  fs.writeFileSync(golangciPath, insertBeforeMarkerOnce(content, DEPGUARD_MARKER, depguardRule(goModule, pkg), `${ruleName(pkg)}:`));
}

// unpatchGolangciForModule drops the rule again, matched by its heading and
// everything indented under it — the inverse of patchGolangciForModule.
export function unpatchGolangciForModule(golangciPath: string, pkg: string): void {
  if (!fs.existsSync(golangciPath)) return;
  const lines = fs.readFileSync(golangciPath, "utf8").split("\n");

  const heading = `${ruleName(pkg)}:`;
  const start = lines.findIndex((l) => l.trim() === heading);
  if (start === -1) return;

  const indent = lines[start].length - lines[start].trimStart().length;
  let end = start + 1;
  while (end < lines.length) {
    const line = lines[end];
    // blank lines belong to the block only if something indented follows
    const deeper = line.trim() === "" || line.length - line.trimStart().length > indent;
    if (!deeper) break;
    end++;
  }

  lines.splice(start, end - start);
  fs.writeFileSync(golangciPath, lines.join("\n"));
}
