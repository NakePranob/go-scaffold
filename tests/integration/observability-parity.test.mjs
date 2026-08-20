// The README promises `create --observability` and `create` + `add
// observability` produce the same project, and nothing checked it — the smoke
// suite only ever runs the first path, and it's Docker-gated at that. The two
// paths had in fact drifted: the architect docs gate their observability
// sections on a create-time flag, so a retrofitted project kept saying
// `disabled` while having a live /metrics endpoint.
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(path.dirname(path.dirname(fileURLToPath(import.meta.url))));
const CLI = path.join(ROOT, "bin", "go-scaffold.js");

function cli(cwd, ...args) {
  execFileSync("node", [CLI, ...args], { cwd, stdio: ["ignore", "pipe", "pipe"] });
}

// every file under dir, relative and sorted
function treeOf(dir, prefix = "") {
  return readdirSync(dir, { withFileTypes: true })
    .flatMap((entry) => {
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
      return entry.isDirectory() ? treeOf(path.join(dir, entry.name), rel) : [rel];
    })
    .sort();
}

const ARCHITECT_DOCS = ["docs/architect/architecture.md", "docs/architect/techstack.md"];

// Both projects get the SAME name, in separate parent directories, so the
// files compare byte for byte with no normalisation. (Normalising a name out
// of the text doesn't work: "app" is a substring of apperror/mapped/app-side.)
function buildBothWays(t, createFlags) {
  const dir = mkdtempSync(path.join(tmpdir(), "gs-obs-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const upfrontDir = path.join(dir, "upfront");
  const retroDir = path.join(dir, "retro");
  mkdirSync(upfrontDir);
  mkdirSync(retroDir);

  cli(upfrontDir, "create", "app", "--defaults", "--observability", ...createFlags);
  cli(retroDir, "create", "app", "--defaults", ...createFlags);
  cli(path.join(retroDir, "app"), "add", "observability", "--yes");

  return { upfront: path.join(upfrontDir, "app"), retro: path.join(retroDir, "app") };
}

function read(root, rel) {
  return readFileSync(path.join(root, rel), "utf8");
}

for (const flags of [[], ["--no-docker"], ["--no-openapi-docs"], ["--api-prefix", ""]]) {
  const label = flags.length ? flags.join(" ") : "defaults";

  test(`create --observability and add observability agree on the architect docs (${label})`, (t) => {
    const { upfront, retro } = buildBothWays(t, flags);
    for (const doc of ARCHITECT_DOCS) {
      assert.equal(read(retro, doc), read(upfront, doc), `${doc} differs between the two paths`);
    }
    // the thing that was actually wrong: a retrofitted project claiming it has
    // no metrics or tracing
    assert.match(read(retro, "docs/architect/techstack.md"), /Metrics \+ tracing[^\n]*`enabled`/);
  });

  test(`both observability paths produce the same set of files (${label})`, (t) => {
    const { upfront, retro } = buildBothWays(t, flags);
    assert.deepEqual(treeOf(retro), treeOf(upfront));
  });
}

// An edited doc must survive: the refresh only rewrites a file that still
// byte-matches what this CLI would have generated with observability off.
test("add observability leaves a hand-edited architect doc alone", (t) => {
  const dir = mkdtempSync(path.join(tmpdir(), "gs-obs-edit-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  cli(dir, "create", "app", "--defaults");
  const app = path.join(dir, "app");

  const doc = path.join(app, "docs", "architect", "architecture.md");
  const mine = readFileSync(doc, "utf8") + "\n## My own section\n";
  writeFileSync(doc, mine);

  cli(app, "add", "observability", "--yes");

  assert.equal(readFileSync(doc, "utf8"), mine, "the edited doc must not be overwritten");
  // ...while the untouched one is still brought up to date
  assert.match(
    readFileSync(path.join(app, "docs", "architect", "techstack.md"), "utf8"),
    /Metrics \+ tracing[^\n]*`enabled`/
  );
});

// A doc checked out with CRLF is not an edit. Comparing raw bytes made every
// Windows checkout look hand-edited, so the feature silently never fired.
test("add observability still refreshes docs checked out with CRLF endings", (t) => {
  const dir = mkdtempSync(path.join(tmpdir(), "gs-obs-crlf-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  cli(dir, "create", "app", "--defaults");
  const app = path.join(dir, "app");

  for (const rel of ARCHITECT_DOCS) {
    const p = path.join(app, rel);
    writeFileSync(p, readFileSync(p, "utf8").replace(/\n/g, "\r\n"));
  }

  cli(app, "add", "observability", "--yes");

  // anchored to the metrics line specifically: `enabled` also appears on the
  // Docker and OpenAPI lines, so a bare /`enabled`/ matches either way and
  // asserts nothing
  const techstack = readFileSync(path.join(app, "docs", "architect", "techstack.md"), "utf8");
  assert.match(techstack, /Metrics \+ tracing[^\n]*`enabled`/, "a CRLF checkout must still get the refresh");
  assert.match(
    readFileSync(path.join(app, "docs", "architect", "architecture.md"), "utf8"),
    /## \d+\. Observability/,
    "architecture.md should have gained its Observability section"
  );
});
