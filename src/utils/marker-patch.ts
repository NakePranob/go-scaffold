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
  // A function replacer, not a string one: String.replace treats "$$", "$&",
  // digit-groups etc. in a *string* replacement as special patterns even when
  // the search argument is a plain string, not a regex — collapsing any "$$"
  // that happens to appear in importLine. A function's return value is spliced
  // in literally, so this holds regardless of what importPath contains.
  return content.replace(/import \(\n/, () => `import (\n\t${importLine}\n`);
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

// removeBlock removes a multi-line block inserted by insertBeforeMarker,
// matched as one contiguous run (each line compared trimmed) rather than
// line-by-line like removeLines. Needed when a block's individual lines
// aren't unique on their own — two modules' schema-creation blocks in
// main.go are identical except for the schema name itself, and removeLines
// would delete the shared lines from both when asked to remove just one.
export function removeBlock(content: string, block: string): string {
  const blockLines = block.split("\n").map((l) => l.trim());
  const lines = content.split("\n");
  const out: string[] = [];
  for (let i = 0; i < lines.length; ) {
    const matches = blockLines.every((bl, j) => lines[i + j]?.trim() === bl);
    if (matches) {
      i += blockLines.length;
    } else {
      out.push(lines[i]);
      i += 1;
    }
  }
  return out.join("\n");
}

// removeLinesByPrefix is removeLines for a line the user is expected to edit
// after it was generated — a service constructor that has since gained a
// dependency, say. Matching the whole line would miss it and leave the
// project un-compilable after `remove module`; matching a distinctive prefix
// (`orderSvc :=`) still finds it. Only use it where the prefix is unique.
export function removeLinesByPrefix(content: string, prefixes: string[]): string {
  return content
    .split("\n")
    .filter((l) => !prefixes.some((p) => l.trim().startsWith(p)))
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
  // Function replacer, not a string one — see the comment on ensureImport.
  // Every caller of this — main.go/patterns.md route and import wiring,
  // depguard rules, rbac's main.go patches — funnels through here, so fixing
  // it here is what actually closes the bug off, rather than auditing every
  // block a caller happens to pass in today.
  return content.replace(markerLine, () => `${indentedBlock}\n${markerLine}`);
}
