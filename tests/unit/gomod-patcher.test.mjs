// Pinning `add *`'s third-party deps is the difference between two people
// running the same CLI a month apart getting the same build or not — `go mod
// tidy` reaches for latest only when go.mod has no opinion.
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { patchGoModRequires } from "../../dist/utils/gomod-patcher.js";

const BASE = ["module app", "", "go 1.25", "", "require (", "\tgithub.com/gin-gonic/gin v1.10.1", ")", ""].join("\n");

function goModWith(t, content) {
  const dir = mkdtempSync(path.join(tmpdir(), "gs-gomod-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, "go.mod");
  writeFileSync(file, content);
  return file;
}

function requiresIn(file) {
  return readFileSync(file, "utf8")
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.includes(" v") && !l.startsWith("//"));
}

test("adds pinned requires inside the existing require block", (t) => {
  const file = goModWith(t, BASE);
  patchGoModRequires(file, ["github.com/hibiken/asynq v0.26.0"]);

  const content = readFileSync(file, "utf8");
  assert.match(content, /require \(\n\tgithub\.com\/gin-gonic\/gin v1\.10\.1\n\tgithub\.com\/hibiken\/asynq v0\.26\.0\n\)/);
});

test("is idempotent — a second call adds nothing", (t) => {
  const file = goModWith(t, BASE);
  patchGoModRequires(file, ["github.com/hibiken/asynq v0.26.0"]);
  const once = readFileSync(file, "utf8");
  patchGoModRequires(file, ["github.com/hibiken/asynq v0.26.0"]);
  assert.equal(readFileSync(file, "utf8"), once);
});

// A version the user deliberately bumped (or one `go mod tidy` raised for
// another feature) is not ours to reset back to our pin.
test("leaves a module that's already present at whatever version it's on", (t) => {
  const file = goModWith(t, BASE.replace("gin v1.10.1", "gin v1.11.0"));
  patchGoModRequires(file, ["github.com/gin-gonic/gin v1.10.1"]);
  assert.match(readFileSync(file, "utf8"), /gin v1\.11\.0/);
  assert.equal(requiresIn(file).filter((l) => l.startsWith("github.com/gin-gonic/gin")).length, 1);
});

// go.opentelemetry.io/otel is a prefix of go.opentelemetry.io/otel/sdk — a
// substring check would decide sdk was already there and silently drop it.
test("a module whose path prefixes another is not mistaken for it", (t) => {
  const file = goModWith(t, BASE);
  patchGoModRequires(file, ["go.opentelemetry.io/otel v1.45.0"]);
  patchGoModRequires(file, ["go.opentelemetry.io/otel/sdk v1.45.0", "go.opentelemetry.io/otel/trace v1.45.0"]);

  const requires = requiresIn(file);
  for (const m of ["go.opentelemetry.io/otel v1.45.0", "go.opentelemetry.io/otel/sdk v1.45.0", "go.opentelemetry.io/otel/trace v1.45.0"]) {
    assert.ok(requires.includes(m), `missing ${m}`);
  }
});

test("appends a require block when go.mod has none", (t) => {
  const file = goModWith(t, "module app\n\ngo 1.25\n");
  patchGoModRequires(file, ["github.com/hibiken/asynq v0.26.0"]);
  assert.match(readFileSync(file, "utf8"), /require \(\n\tgithub\.com\/hibiken\/asynq v0\.26\.0\n\)/);
});

test("a missing go.mod is a no-op, not a crash", (t) => {
  const dir = mkdtempSync(path.join(tmpdir(), "gs-gomod-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  assert.doesNotThrow(() => patchGoModRequires(path.join(dir, "go.mod"), ["x v1.0.0"]));
});
