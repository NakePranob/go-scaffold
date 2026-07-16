// Shared text-marker patching: find a line that's exactly a marker comment,
// insert a block right above it (re-indented to match), and leave the marker
// in place so the next generate call can insert above it again.
// ponytail: text insertion at a fixed marker, not a Go AST rewrite — good
// enough for appending declarations; reach for go/ast if a patch ever needs
// to understand existing code, not just append next to it.

export function hasMarker(content: string, marker: string): boolean {
  return content.split("\n").some((l) => l.trim() === marker);
}

// ensureImport adds an import line if it's not already present — needed
// because a minimal module's handler.go starts without net/http/httpx/
// pagination, and generate method's patches are the first thing to need
// them. Idempotent, so repeat calls (e.g. two generate method calls) are
// safe; doesn't attempt import grouping/sorting, just validity — run
// goimports separately if you want that tidied up.
export function ensureImport(content: string, importPath: string): string {
  const importLine = `"${importPath}"`;
  if (content.includes(importLine)) return content;
  return content.replace(/import \(\n/, `import (\n\t${importLine}\n`);
}

// insertBeforeMarkerOnce: like insertBeforeMarker but a no-op if `sentinel`
// already appears in the file. Makes module wiring idempotent — re-running
// `generate module` after deleting just the module folder (leaving main.go /
// openapi.yaml still referencing it) won't duplicate the import/route/path.
// A duplicate route silently passes build+vet, then panics gin at startup
// ("handlers are already registered"), so this guard matters.
export function insertBeforeMarkerOnce(content: string, marker: string, block: string, sentinel: string): string {
  if (content.includes(sentinel)) return content;
  return insertBeforeMarker(content, marker, block);
}

// removeLines drops every line whose trimmed text exactly equals one of the
// given lines — the inverse of insertBeforeMarker for `remove module`, which
// needs to pull a module's import/route/path entries back out. Exact-trim
// match so it can't clip an unrelated line that merely contains the text.
export function removeLines(content: string, trimmedLines: string[]): string {
  const drop = new Set(trimmedLines.map((l) => l.trim()));
  return content
    .split("\n")
    .filter((l) => !drop.has(l.trim()))
    .join("\n");
}

export function insertBeforeMarker(content: string, marker: string, block: string): string {
  const lines = content.split("\n");
  const markerLine = lines.find((l) => l.trim() === marker);
  if (markerLine === undefined) {
    throw new Error(
      `marker "${marker}" not found — the file may have been hand-edited; add the marker back or edit it by hand`
    );
  }
  const indent = markerLine.match(/^\s*/)?.[0] ?? "";
  const indentedBlock = block
    .split("\n")
    .map((line) => (line ? `${indent}${line}` : line))
    .join("\n");
  return content.replace(markerLine, `${indentedBlock}\n${markerLine}`);
}
