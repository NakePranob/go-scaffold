import fs from "fs-extra";

// Every `add` command pulls in third-party packages, and none of them used to
// touch go.mod — the imports just appeared and `go mod tidy` was left to
// resolve them. Tidy picks the latest release of anything it doesn't already
// have a version for, so two people running `add auth` a month apart got
// different builds from the same CLI, and nothing recorded which versions the
// scaffold was actually written and tested against.
//
// Pinning here fixes that: tidy honours a version that's already in go.mod
// rather than reaching for latest. It's a floor, not a ceiling — if another
// feature needs something newer, tidy still resolves upward, which is why
// golang.org/x/crypto can be pinned by `add auth` and later raised by
// `add observability`.
//
// Users still need to run `go mod tidy` (every command says so): these lines
// have no go.sum entries, and only tidy can add those.
export function patchGoModRequires(goModPath: string, requires: string[]): void {
  if (!fs.existsSync(goModPath)) return;
  let content = fs.readFileSync(goModPath, "utf8");

  // already-present modules are left at whatever version they're on: a
  // re-run, or a version the user deliberately bumped, is not ours to reset
  const missing = requires.filter((line) => !hasModule(content, modulePathOf(line)));
  if (missing.length === 0) return;

  const block = content.match(/^require \(\n(?:.*\n)*?\)$/m);
  if (!block) {
    // no grouped require block (hand-edited, or single-line `require x y`
    // form) — append one rather than trying to rewrite what's there
    content = content.replace(/\n?$/, "\n") + `\nrequire (\n${missing.map((l) => `\t${l}`).join("\n")}\n)\n`;
    fs.writeFileSync(goModPath, content);
    return;
  }

  const updated = block[0].replace(/\n\)$/, `\n${missing.map((l) => `\t${l}`).join("\n")}\n)`);
  // function replacer: a version string can't contain $ today, but this is the
  // same trap ensureImport documents and costs nothing to avoid
  fs.writeFileSync(goModPath, content.replace(block[0], () => updated));
}

function modulePathOf(requireLine: string): string {
  return requireLine.trim().split(/\s+/)[0];
}

// Word-boundary match on the module path, so `go.opentelemetry.io/otel`
// doesn't count as already-present when only `go.opentelemetry.io/otel/sdk`
// is there.
function hasModule(goMod: string, modulePath: string): boolean {
  return goMod.split("\n").some((line) => modulePathOf(line) === modulePath);
}
