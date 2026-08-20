// go-scaffold.config.json is written by whichever CLI version ran last, so a
// project can hold a file that predates a feature key. Every one of these
// bugs was the same shape: a key was missing, a caller read that as "no", and
// guessed. readConfig now fills missing keys from the tree — these pin that,
// and pin that a key the file DOES answer still wins.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(path.dirname(path.dirname(fileURLToPath(import.meta.url))));
const CLI = path.join(ROOT, "bin", "go-scaffold.js");

const cli = (cwd, ...args) =>
  execFileSync("node", [CLI, ...args], { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });

function cliFails(cwd, ...args) {
  try {
    execFileSync("node", [CLI, ...args], { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  } catch (e) {
    return `${e.stdout ?? ""}${e.stderr ?? ""}`;
  }
  throw new Error(`expected \`${args.join(" ")}\` to fail, it succeeded`);
}

function project(t, label) {
  const dir = mkdtempSync(path.join(tmpdir(), `go-scaffold-${label}-`));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  cli(dir, "create", "app", "--defaults", "--no-docker");
  return path.join(dir, "app");
}

const configPath = (app) => path.join(app, "go-scaffold.config.json");
const read = (app, ...p) => readFileSync(path.join(app, ...p), "utf8");

// drops a feature key, the way a config written by an older CLI would not have it
function dropFeature(app, key) {
  const cfg = JSON.parse(read(app, "go-scaffold.config.json"));
  delete cfg.features[key];
  writeFileSync(configPath(app), JSON.stringify(cfg, null, 2));
}

// `add auth` guessed "asynq" for a missing queue key, which wrote
// queue.NewAsynqEnqueuer(cfg.RedisURL) into a River-only project. Neither
// symbol exists there, and the gate after that patch is parse-only (the new
// deps aren't in go.mod yet), so the CLI exited 0 over a project that no
// longer compiled.
test("a config with no queue key does not make add auth guess the wrong enqueuer", (t) => {
  const app = project(t, "stale-queue");
  cli(app, "add", "worker", "--queue", "postgres", "--yes");
  dropFeature(app, "queue");

  cli(app, "add", "auth", "--defaults");

  const wiring = read(app, "cmd/api/wiring.go");
  assert.match(wiring, /queue\.NewRiverEnqueuer\(db\)/, "must wire the adapter this project actually has");
  assert.doesNotMatch(wiring, /NewAsynqEnqueuer/, "River project must never get the Asynq enqueuer");
  assert.doesNotMatch(wiring, /cfg\.RedisURL/, "River project has no RedisURL in its config struct");
});

// The refusal that stops `undo module` deleting the auth domain read
// config.features.auth. With the key missing it deleted internal/app/user
// outright, leaving cmd/seed importing a package that no longer exists and
// the identities/auth_tokens migrations pointing at a users table whose
// create migration went with it.
test("a config with no auth key still refuses to undo the auth domain", (t) => {
  const app = project(t, "stale-auth");
  cli(app, "add", "auth", "--defaults");
  dropFeature(app, "auth");

  const out = cliFails(app, "undo", "module", "user", "-y");
  assert.match(out, /belongs to `go-scaffold add auth`/);
  assert.ok(existsSync(path.join(app, "internal/app/user")), "the auth domain must still be there");
  assert.ok(existsSync(path.join(app, "cmd/seed/main.go")), "and cmd/seed must not be left dangling");
});

// The mirror of the above: detection keys auth/rbac on their middleware, not
// on internal/app/{user,role} existing, because `generate module user` makes
// that directory too. Detecting by directory would make undo refuse to remove
// a module it generated itself — an unfixable module name.
test("a hand-generated user module is still undoable when auth was never added", (t) => {
  const app = project(t, "user-module");
  cli(app, "generate", "module", "user", "--defaults");
  assert.ok(!existsSync(path.join(app, "internal/shared/middleware/auth.go")), "precondition: no add auth here");

  cli(app, "undo", "module", "user", "-y");
  assert.ok(!existsSync(path.join(app, "internal/app/user")), "undo must remove a module it generated");
});

// A key the file answers is an answer, not a hole — detection fills gaps, it
// does not overrule. Proved on the one flag whose value is visible in the
// output: `worker` decides whether auth wires the async or the sync mailer.
test("an explicit false in the config wins over what is on disk", (t) => {
  const app = project(t, "explicit-false");
  cli(app, "add", "worker", "--queue", "postgres", "--yes");

  const cfg = JSON.parse(read(app, "go-scaffold.config.json"));
  cfg.features.worker = false; // internal/platform/queue is still on disk
  writeFileSync(configPath(app), JSON.stringify(cfg, null, 2));

  cli(app, "add", "auth", "--defaults");

  const wiring = read(app, "cmd/api/wiring.go");
  assert.match(wiring, /mail\.NewSyncClient/, "the file said no worker, so auth must wire the sync mailer");
  assert.doesNotMatch(wiring, /mail\.NewAsyncClient/, "detection must not overrule an explicit false");
});
