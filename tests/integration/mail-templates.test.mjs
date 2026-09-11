// The mail surface is split across two commands: `add auth` installs the SMTP
// client and the copy it renders, `add worker` adds the queue job on top. Both
// paths have to produce a project that compiles, which is exactly what broke
// once — a handler test shipped with the client, referring to a symbol only
// the worker half defines.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(path.dirname(path.dirname(fileURLToPath(import.meta.url))));
const CLI = path.join(ROOT, "bin", "go-scaffold.js");

const cli = (cwd, ...args) =>
  execFileSync("node", [CLI, ...args], { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });

function project(t, name) {
  const dir = mkdtempSync(path.join(tmpdir(), `go-scaffold-mail-${name}-`));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  cli(dir, "create", "app", "--defaults", "--no-docker");
  return path.join(dir, "app");
}

const read = (app, ...segments) => readFileSync(path.join(app, ...segments), "utf8");
const has = (app, ...segments) => existsSync(path.join(app, ...segments));

test("add auth ships the mail copy as Go templates, not as strings in a service", (t) => {
  const app = project(t, "auth");
  cli(app, "add", "auth", "--defaults");

  for (const file of ["emails.go", "emails_test.go"]) {
    assert.equal(has(app, "internal", "shared", "emails", file), true, `missing ${file}`);
  }
  for (const file of ["layout.html", "reset_password.html", "verify_email.html"]) {
    assert.equal(has(app, "internal", "shared", "emails", "templates", file), true, `missing ${file}`);
  }

  // Handlebars and Go's template package both spell interpolation {{...}}.
  // Without the raw helper the generator eats the file and writes out an empty
  // one, which compiles and then renders nothing.
  const layout = read(app, "internal", "shared", "emails", "templates", "layout.html");
  assert.match(layout, /\{\{define "layout"\}\}/);
  assert.match(layout, /\{\{template "content" \.\}\}/);
  assert.equal(layout.includes("{{{{raw}}}}"), false, "the raw wrapper leaked into the generated file");

  // The service asks for a template by name; no copy is written in Go.
  const recovery = read(app, "internal", "app", "user", "application", "recovery_service.go");
  assert.match(recovery, /emails\.ResetPassword/);
  assert.match(recovery, /emails\.VerifyEmail/);
  assert.equal(/Send\(ctx, u\.Email, "/.test(recovery), false, "a subject is still hard-coded in the service");

  // task.go is the worker half. Its test must not ship without it.
  assert.equal(has(app, "internal", "platform", "mail", "task.go"), false);
  assert.equal(has(app, "internal", "platform", "mail", "task_test.go"), false);
  assert.equal(has(app, "internal", "platform", "mail", "mail_test.go"), true);
});

test("add worker brings the queue job and its own test along", (t) => {
  const app = project(t, "worker");
  cli(app, "add", "auth", "--defaults");
  cli(app, "add", "worker", "--queue", "postgres", "--yes");

  assert.equal(has(app, "internal", "platform", "mail", "task.go"), true);
  assert.equal(has(app, "internal", "platform", "mail", "task_test.go"), true);

  // A payload written by an older binary has "body" and no html/text. Dropping
  // that field would turn every job still in the queue into a blank mail.
  const task = read(app, "internal", "platform", "mail", "task.go");
  assert.match(task, /Body\s+string\s+`json:"body,omitempty"`/);
  assert.match(task, /p\.Text = p\.Body/);

  // River keeps finished jobs for a day by default, and a mail payload is a
  // password-reset link.
  const river = read(app, "internal", "platform", "queue", "river.go");
  assert.match(river, /CompletedJobRetentionPeriod: time\.Minute/);
});

test("every target that acts on DB_DSN refuses a database on another machine", (t) => {
  const app = project(t, "guard");
  cli(app, "add", "auth", "--defaults");
  cli(app, "add", "worker", "--queue", "postgres", "--yes");

  const makefile = read(app, "Makefile");
  assert.match(makefile, /define refuse_remote_db/);
  for (const target of ["run", "dev", "worker", "seed", "river-migrate", "migrate-up", "migrate-down"]) {
    const recipe = makefile.slice(makefile.indexOf(`\n${target}:`));
    assert.match(
      recipe.slice(0, 200),
      /\$\(refuse_remote_db\)/,
      `${target} can be pointed at somebody else's database`
    );
  }

  let refused;
  try {
    execFileSync("make", ["migrate-up"], {
      cwd: app,
      encoding: "utf8",
      env: { ...process.env, ENV_FILE: "/dev/null", DB_DSN: "postgres://u:p@10.0.0.5:5432/x" },
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (err) {
    refused = err;
  }
  assert.ok(refused, "migrate-up ran against a database on another machine");
  // The explanation is on stdout, where make put it — the thrown error only
  // carries make's own "Error 1".
  assert.match(refused.stdout, /points at 10\.0\.0\.5:5432, not this machine/);
  // The password must not be in what it prints.
  assert.equal(refused.stdout.includes("u:p@"), false, "the guard echoed the DSN credentials");

  // ...and the escape hatch still works, or the guard just becomes a thing
  // people delete.
  const allowed = execFileSync("make", ["-n", "migrate-up"], {
    cwd: app,
    encoding: "utf8",
    env: { ...process.env, ENV_FILE: "/dev/null", DB_DSN: "postgres://u:p@10.0.0.5:5432/x", ALLOW_REMOTE_DB: "1" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  assert.match(allowed, /migrate -path migrations/);
});
