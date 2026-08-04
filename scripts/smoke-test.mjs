#!/usr/bin/env node
// End-to-end smoke test for the go-scaffold CLI: exercises create + generate
// module (full and minimal) + generate method against a real Go toolchain in
// a scratch directory, and checks the guard rails (bad names, duplicates,
// forbidden flags) actually reject. No Postgres required — integration
// tests inside the generated project skip gracefully if the DB isn't up,
// the same behavior the CLI itself scaffolds for every project.
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, existsSync, readFileSync, readdirSync, writeFileSync, writeSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const CLI = path.join(ROOT, "bin", "go-scaffold.js");

let passed = 0;
let scratch;

function step(name, fn) {
  process.stdout.write(`- ${name} ... `);
  try {
    fn();
    console.log("ok");
    passed++;
  } catch (err) {
    console.log("FAILED");
    // console.error + process.exit() can race: stderr isn't a TTY when output is
    // piped/redirected (every way this script actually gets run — CI, `pnpm run
    // verify`, a log file), so the write can still be buffered when exit() tears
    // the process down, silently dropping the one line that explains the failure.
    // writeSync is synchronous, so it's flushed before exit() runs.
    const detail = err.stdout?.toString() || err.stderr?.toString() || err.message;
    writeSync(2, `${detail}\n`);
    cleanup();
    process.exit(1);
  }
}

function run(cmd, args, cwd, env) {
  return execFileSync(cmd, args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    env: env ? { ...process.env, ...env } : process.env,
  });
}

function goScaffold(args, cwd) {
  return run("node", [CLI, ...args], cwd);
}

function expectThrows(fn, messageFragment) {
  try {
    fn();
  } catch (err) {
    const msg = (err.stdout?.toString() ?? "") + (err.stderr?.toString() ?? "") + err.message;
    if (!msg.includes(messageFragment)) {
      throw new Error(`expected error containing "${messageFragment}", got: ${msg}`);
    }
    return;
  }
  throw new Error(`expected an error containing "${messageFragment}", but it succeeded`);
}

function assertFileContains(filePath, needle) {
  if (!existsSync(filePath)) throw new Error(`missing file: ${filePath}`);
  const content = readFileSync(filePath, "utf8");
  if (!content.includes(needle)) throw new Error(`${filePath} doesn't contain "${needle}"`);
}

// Set by the "add worker" step once it patches fullApp's readyz to also ping
// Redis — every later step in this file that boots fullApp's cmd/api shares
// that same project, so it needs a reachable Redis from that point on too,
// not just its own concern (DB, CORS, migrations, ...). Kept alive for the
// rest of the run instead of torn down at the end of that one step; cleaned
// up here at the very end.
let sharedRedisContainerId = null;
let sharedRedisUrl = null;

function cleanup() {
  if (sharedRedisContainerId) {
    try {
      execFileSync("docker", ["rm", "-f", sharedRedisContainerId], { stdio: "ignore" });
    } catch {
      // best-effort — a failed cleanup here shouldn't mask the real test result
    }
  }
  if (scratch && existsSync(scratch)) rmSync(scratch, { recursive: true, force: true });
}

if (!existsSync(path.join(ROOT, "dist", "index.js"))) {
  console.error("dist/index.js missing — run `pnpm run build` first");
  process.exit(1);
}
try {
  run("go", ["version"]);
} catch {
  console.error("no Go toolchain on PATH — required for the smoke test");
  process.exit(1);
}

scratch = mkdtempSync(path.join(tmpdir(), "go-scaffold-smoke-"));
console.log(`scratch dir: ${scratch}\n`);

step("rejects an invalid project name before writing anything", () => {
  expectThrows(() => goScaffold(["create", "My Cool App", "--defaults"], scratch), "invalid project name");
});

step("create --defaults scaffolds a bare project", () => {
  goScaffold(["create", "full-app", "--defaults"], scratch);
  assertFileContains(path.join(scratch, "full-app", "go.mod"), "module full-app");
});

step("create stamps the CLI version into go-scaffold.config.json", () => {
  const cfg = JSON.parse(readFileSync(path.join(scratch, "full-app", "go-scaffold.config.json"), "utf8"));
  const { version } = JSON.parse(readFileSync(path.join(ROOT, "package.json"), "utf8"));
  if (cfg.scaffoldVersion !== version) {
    throw new Error(`expected scaffoldVersion "${version}", got "${cfg.scaffoldVersion}"`);
  }
});

const fullApp = path.join(scratch, "full-app");
step("bare project: go mod tidy + build + vet", () => {
  run("go", ["mod", "tidy"], fullApp);
  run("go", ["build", "./..."], fullApp);
  run("go", ["vet", "./..."], fullApp);
});

// config.Load() is the first line of main(), before database.Open — an
// unrecognized APP_ENV must panic right there, with no DB required to prove it.
step("APP_ENV rejects an unrecognized value at boot (fails closed)", () => {
  try {
    run("go", ["run", "./cmd/api"], fullApp, { APP_ENV: "staging" });
    throw new Error("expected `go run` to exit nonzero on an invalid APP_ENV, it exited 0");
  } catch (err) {
    const out = `${err.stdout ?? ""}${err.stderr ?? ""}`;
    if (!out.includes('invalid APP_ENV "staging"')) {
      throw new Error(`expected a panic naming the bad APP_ENV value, got:\n${out}`);
    }
  }
});

// middleware.Error(exposeDetail)'s whole reason to exist: prod must not leak
// Details (a validation field map, or an unexpected error's real message) to
// a caller. The generated CRUD stub's DTO has no fields, so nothing over real
// HTTP naturally exercises the field-map path — test the middleware directly
// instead, against the exact package layout `create` scaffolds.
step("middleware.Error hides Details in prod, shows them outside it", () => {
  const probeDir = path.join(fullApp, "cmd", "_smoke_probe_apperr");
  const { goModule } = JSON.parse(readFileSync(path.join(fullApp, "go-scaffold.config.json"), "utf8"));
  execFileSync("mkdir", ["-p", probeDir]);
  writeFileSync(
    path.join(probeDir, "main.go"),
    `package main

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"

	"${goModule}/internal/shared/apperror"
	"${goModule}/internal/shared/middleware"

	"github.com/gin-gonic/gin"
)

func try(expose bool, err error) {
	gin.SetMode(gin.TestMode)
	r := gin.New()
	r.Use(middleware.RequestID(), middleware.Error(expose))
	r.GET("/x", func(c *gin.Context) { c.Error(err) })
	req := httptest.NewRequest(http.MethodGet, "/x", nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	var body map[string]any
	json.Unmarshal(w.Body.Bytes(), &body)
	out, _ := json.Marshal(body)
	fmt.Printf("expose=%v %s\\n", expose, out)
}

func main() {
	try(true, apperror.NewValidation("invalid input", map[string]string{"email": "required"}))
	try(false, apperror.NewValidation("invalid input", map[string]string{"email": "required"}))
	try(true, fmt.Errorf("pq: connection refused"))
	try(false, fmt.Errorf("pq: connection refused"))
}
`
  );
  try {
    const out = run("go", ["run", "./cmd/_smoke_probe_apperr"], fullApp);
    if (!/expose=true .*"details":\{"email":"required"\}/.test(out)) {
      throw new Error(`expected exposed Details for a known AppError, got:\n${out}`);
    }
    if (/expose=false .*"details"/.test(out)) {
      throw new Error(`expected no "details" key at all when exposeDetail is false, got:\n${out}`);
    }
    if (!/expose=true .*"details":"pq: connection refused"/.test(out)) {
      throw new Error(`expected the real error text exposed for an unexpected error, got:\n${out}`);
    }
  } finally {
    rmSync(probeDir, { recursive: true, force: true });
  }
});

let hasDocker = true;
try {
  run("docker", ["--version"]);
} catch {
  hasDocker = false;
}

let hasNpx = true;
try {
  run("npx", ["--version"]);
} catch {
  hasNpx = false;
}

// docker port prints one line per protocol family ("0.0.0.0:PORT" and
// "[::]:PORT") for an ephemeral (-p 0:CONTAINER_PORT) mapping — both name the
// same host port, so the last field after splitting on ":" is it regardless
// of which line answers first.
function readMappedPort(containerId) {
  const portMap = run("docker", ["port", containerId, "6379/tcp"]).trim();
  return portMap.split(":").pop();
}

// polls a localhost TCP port via bash's /dev/tcp (no netcat/redis-cli
// dependency on the host) — used to wait out the gap between `docker start`
// returning and the host-mapped port actually accepting connections again.
function waitForPort(port, attempts = 30) {
  for (let i = 0; i < attempts; i++) {
    try {
      run("bash", ["-c", `echo > /dev/tcp/127.0.0.1/${port}`]);
      return;
    } catch {
      run("sleep", ["0.3"]);
    }
  }
  throw new Error(`port ${port} never accepted a connection`);
}

// `add worker` end to end: readyz picks up a real Redis outage, and a task
// enqueued through mail.AsyncClient is actually processed by cmd/worker (dev
// fallback: logs instead of sending, since SMTP_HOST is unset). Runs its own
// throwaway Redis on a Docker-assigned ephemeral port — not the host's
// default 6379 — so it can't collide with a Redis someone already has
// running (this dev machine's own has auth enabled, which would otherwise
// make the readyz check fail for a reason that has nothing to do with the
// scaffold's own correctness).
step(hasDocker ? "add worker: scaffolds cache/queue/mail/cmd/worker, wires readyz, processes a real task" : "add worker: skipped (needs Docker for an isolated Redis)", () => {
  if (!hasDocker) return;

  goScaffold(["add", "worker"], fullApp);
  run("go", ["mod", "tidy"], fullApp);
  run("go", ["build", "./..."], fullApp);
  run("go", ["vet", "./..."], fullApp);

  // cmd/api opens Postgres before it ever gets to Redis (database.Open runs
  // first in main()) — needs a real DB up before it'll boot far enough to
  // reach the readyz check this step is actually testing. Let the Makefile
  // target handle its own local-psql-vs-docker fallback, same as every other
  // step that needs a DB.
  run("make", ["db-drop"], fullApp);
  run("make", ["db-create"], fullApp);

  // no --rm: this step stops the container mid-test (to prove readyz notices
  // Redis going down) then starts it again. It also stays alive past the end
  // of this step (cleaned up in the top-level cleanup() instead): once
  // patched, every later step that boots fullApp's cmd/api needs Redis
  // reachable too, since they all share this one scratch project — not just
  // this step's own concern.
  const containerId = run("docker", ["run", "-d", "-p", "0:6379", "redis:7-alpine"]).trim();
  sharedRedisContainerId = containerId;
  {
    let redisPort = readMappedPort(containerId);
    let redisUrl = `redis://localhost:${redisPort}/0`;

    // `docker exec redis-cli ping` only proves the container's *internal*
    // network is up — it says nothing about the host-mapped port this test
    // (and the app) actually connects through, which can lag behind after a
    // stop/start cycle. Poll the real host port instead, via bash's /dev/tcp
    // (no extra tool dependency).
    waitForPort(redisPort);

    const up = run(
      "bash",
      [
        "-c",
        `REDIS_URL='${redisUrl}' go run ./cmd/api >/tmp/go-scaffold-smoke-worker-api.log 2>&1 & sleep 3; ` +
          "CODE=$(curl -s -o /dev/null -w '%{http_code}' http://localhost:8080/readyz 2>/dev/null); CODE=${CODE:-000}; " +
          "lsof -ti:8080 | xargs -r kill -9; " +
          "echo \"READYZ=$CODE\"",
      ],
      fullApp
    );
    if (!/READYZ=200/.test(up)) throw new Error(`expected readyz 200 with Redis reachable, got: ${up}`);

    run("docker", ["stop", containerId]);
    const down = run(
      "bash",
      [
        "-c",
        `REDIS_URL='${redisUrl}' go run ./cmd/api >/tmp/go-scaffold-smoke-worker-api.log 2>&1 & sleep 3; ` +
          "CODE=$(curl -s -o /dev/null -w '%{http_code}' http://localhost:8080/readyz 2>/dev/null); CODE=${CODE:-000}; " +
          "lsof -ti:8080 | xargs -r kill -9; " +
          "echo \"READYZ=$CODE\"",
      ],
      fullApp
    );
    if (!/READYZ=503/.test(down)) throw new Error(`expected readyz 503 with Redis down, got: ${down}`);
    run("docker", ["start", containerId]);
    // Docker Desktop can hand out a *different* random host port on restart
    // when the container was published with an ephemeral mapping (-p 0:6379)
    // — re-read it rather than assuming `docker start` preserves the one from
    // `docker run`. Silently reusing the stale port here is exactly what
    // produced a flaky "port never accepted a connection" failure while
    // testing this: the container's logs showed Redis back up and accepting
    // connections in well under a second, on a port one number higher than
    // what this step kept polling.
    redisPort = readMappedPort(containerId);
    redisUrl = `redis://localhost:${redisPort}/0`;
    waitForPort(redisPort);

    const probeDir = path.join(fullApp, "cmd", "_smoke_probe_enqueue");
    execFileSync("mkdir", ["-p", probeDir]);
    writeFileSync(
      path.join(probeDir, "main.go"),
      `package main

import (
	"full-app/internal/platform/mail"
	"full-app/internal/platform/queue"
)

func main() {
	q, err := queue.NewClient("${redisUrl}")
	if err != nil {
		panic(err)
	}
	ac := mail.NewAsyncClient(q)
	if err := ac.Send("someone@example.com", "smoke test", "processed by cmd/worker"); err != nil {
		panic(err)
	}
}
`
    );

    // `go run ./cmd/worker & WPID=$!` doesn't work: `go run` compiles then
    // execs the binary as its OWN child, so $! is the `go` wrapper's PID, not
    // the actual worker process — `kill -9 $WPID` kills the wrapper and
    // leaves the real worker running forever, retrying against a container
    // that's long gone. Confirmed the hard way: seven of these accumulated
    // over the course of testing this step, one alive for hours, still
    // burning CPU on retry loops. Build the binary and run *that* directly so
    // the PID this test captures is the PID that actually needs to die.
    const workerLogPath = path.join(fullApp, "worker.log");
    run("go", ["build", "-o", "worker-bin", "./cmd/worker"], fullApp);
    run(
      "bash",
      [
        "-c",
        `REDIS_URL='${redisUrl}' ./worker-bin >'${workerLogPath}' 2>&1 & WPID=$!; sleep 2; ` +
          "go run ./cmd/_smoke_probe_enqueue; sleep 2; kill -9 $WPID 2>/dev/null",
      ],
      fullApp
    );
    rmSync(path.join(fullApp, "worker-bin"), { force: true });
    const workerLog = readFileSync(workerLogPath, "utf8");
    if (!workerLog.includes("email not sent (SMTP not configured)") || !workerLog.includes("processed by cmd/worker")) {
      throw new Error(`expected cmd/worker to process the enqueued task (dev SMTP fallback), got:\n${workerLog}`);
    }
    if (workerLog.includes("!BADKEY")) {
      throw new Error(`asynq's own log lines are leaking through the slog adapter malformed, got:\n${workerLog}`);
    }

    rmSync(probeDir, { recursive: true, force: true });
    run("make", ["db-drop"], fullApp);
    sharedRedisUrl = redisUrl; // later steps that boot fullApp's cmd/api reuse this
  }
});

// `add auth` requires `add worker` to already have run (needs Redis for the
// refresh token store) — proven against the real compiled server: register,
// a duplicate register, a wrong-password login, /me with/without a token,
// refresh rotation, and reuse-detection (replaying a rotated-out refresh
// token must revoke every session for that user, not just the replayed one).
step(hasDocker ? "add auth: register/login/refresh rotation+reuse-detection/logout/me/forgot-reset-password/verify-email/google-oauth-redirect/rate-limiting against a real server" : "add auth: skipped (needs Docker for add worker's Redis)", () => {
  if (!hasDocker) return;

  goScaffold(["add", "auth"], fullApp);
  run("go", ["mod", "tidy"], fullApp);
  run("go", ["build", "./..."], fullApp);
  run("go", ["vet", "./..."], fullApp);

  run("make", ["db-drop"], fullApp);
  run("make", ["db-create"], fullApp);

  run(
    "bash",
    ["-c", `REDIS_URL='${sharedRedisUrl}' AUTO_MIGRATE=true go run ./cmd/api >/tmp/go-scaffold-smoke-auth-boot.log 2>&1 & sleep 3`],
    fullApp
  );

  const B = "http://localhost:8080/v1";
  const jsonHeader = ["-H", "Content-Type: application/json"];
  const status = (out) => (out.match(/HTTPSTATUS:(\d+)/) ?? [])[1];
  const field = (out, key) => (out.match(new RegExp(`"${key}":"([^"]*)"`)) ?? [])[1];
  const cookie = (out) => (out.match(/Set-Cookie: refresh_token=([^;]*);/) ?? [])[1];

  const register = run("curl", ["-s", "-i", "-X", "POST", `${B}/auth/register`, ...jsonHeader, "-d", '{"email":"alice@example.com","password":"correcthorsebattery","name":"Alice"}']);
  if (!/^HTTP\/1\.1 201/.test(register)) throw new Error(`expected 201 on register, got:\n${register}`);
  const registerCookie = cookie(register);
  if (!registerCookie) throw new Error(`expected a refresh_token cookie on register, got:\n${register}`);

  const dup = run("curl", ["-s", "-w", "HTTPSTATUS:%{http_code}", "-X", "POST", `${B}/auth/register`, ...jsonHeader, "-d", '{"email":"alice@example.com","password":"correcthorsebattery","name":"Alice"}']);
  if (status(dup) !== "409" || !dup.includes("USER_EMAIL_TAKEN")) throw new Error(`expected 409 USER_EMAIL_TAKEN on duplicate register, got:\n${dup}`);

  const badLogin = run("curl", ["-s", "-w", "HTTPSTATUS:%{http_code}", "-X", "POST", `${B}/auth/login`, ...jsonHeader, "-d", '{"email":"alice@example.com","password":"wrong"}']);
  if (status(badLogin) !== "401" || !badLogin.includes("AUTH_INVALID_CREDENTIALS")) throw new Error(`expected 401 AUTH_INVALID_CREDENTIALS on wrong password, got:\n${badLogin}`);

  const login = run("curl", ["-s", "-i", "-X", "POST", `${B}/auth/login`, ...jsonHeader, "-d", '{"email":"alice@example.com","password":"correcthorsebattery"}']);
  if (!/^HTTP\/1\.1 200/.test(login)) throw new Error(`expected 200 on login, got:\n${login}`);
  const access = field(login, "access_token");
  const loginCookie = cookie(login);
  if (!access || !loginCookie) throw new Error(`expected access_token + refresh_token cookie on login, got:\n${login}`);

  const meNoToken = run("curl", ["-s", "-w", "HTTPSTATUS:%{http_code}", `${B}/users/me`]);
  if (status(meNoToken) !== "401") throw new Error(`expected 401 on /me with no token, got:\n${meNoToken}`);

  const meWithToken = run("curl", ["-s", "-w", "HTTPSTATUS:%{http_code}", `${B}/users/me`, "-H", `Authorization: Bearer ${access}`]);
  if (status(meWithToken) !== "200" || !meWithToken.includes('"email":"alice@example.com"')) {
    throw new Error(`expected 200 with alice's email on /me, got:\n${meWithToken}`);
  }

  const rotated = run("curl", ["-s", "-i", "-X", "POST", `${B}/auth/refresh`, "-H", `Cookie: refresh_token=${loginCookie}`]);
  if (!/^HTTP\/1\.1 200/.test(rotated)) throw new Error(`expected 200 on refresh, got:\n${rotated}`);
  const rotatedCookie = cookie(rotated);
  if (!rotatedCookie || rotatedCookie === loginCookie) throw new Error(`expected a NEW refresh_token cookie after rotation, got:\n${rotated}`);

  const reuseOld = run("curl", ["-s", "-w", "HTTPSTATUS:%{http_code}", "-X", "POST", `${B}/auth/refresh`, "-H", `Cookie: refresh_token=${loginCookie}`]);
  if (status(reuseOld) !== "401") throw new Error(`expected 401 replaying the already-rotated-out refresh token, got:\n${reuseOld}`);

  // reuse-detection's whole point: replaying the old token above must have
  // revoked the WHOLE session family, including the token that replaced it —
  // not just refused the replay itself.
  const reuseRotated = run("curl", ["-s", "-w", "HTTPSTATUS:%{http_code}", "-X", "POST", `${B}/auth/refresh`, "-H", `Cookie: refresh_token=${rotatedCookie}`]);
  if (status(reuseRotated) !== "401") throw new Error(`expected replaying a rotated-out token to revoke the whole session family (rotated token should now 401 too), got:\n${reuseRotated}`);

  // forgot-password/reset-password go through the real async queue (same
  // worker binary + PID-kill lesson as the "add worker" step above: build
  // and run the binary directly, not `go run`, so $! is the real PID).
  run("go", ["build", "-o", "auth-worker-bin", "./cmd/worker"], fullApp);
  const workerLogPath = path.join(fullApp, "auth-worker.log");
  const workerPid = run(
    "bash",
    ["-c", `REDIS_URL='${sharedRedisUrl}' ./auth-worker-bin >'${workerLogPath}' 2>&1 & echo $!`],
    fullApp
  ).trim();
  execFileSync("sleep", ["2"]);

  const forgotExisting = run("curl", ["-s", "-X", "POST", `${B}/auth/forgot-password`, ...jsonHeader, "-d", '{"email":"alice@example.com"}']);
  const forgotMissing = run("curl", ["-s", "-X", "POST", `${B}/auth/forgot-password`, ...jsonHeader, "-d", '{"email":"nobody@example.com"}']);
  if (forgotExisting !== forgotMissing) {
    throw new Error(`expected forgot-password to respond identically for an existing vs unknown email (anti-enumeration), got:\n${forgotExisting}\nvs\n${forgotMissing}`);
  }

  // Register sends a verification email automatically — same queue, same worker.
  const verifymeRegister = run("curl", ["-s", "-X", "POST", `${B}/auth/register`, ...jsonHeader, "-d", '{"email":"verifyme@example.com","password":"correcthorsebattery","name":"Verify Me"}']);
  const verifymeAccess = field(verifymeRegister, "access_token");
  if (!verifymeAccess) throw new Error(`expected an access token registering verifyme@example.com, got:\n${verifymeRegister}`);

  execFileSync("sleep", ["2"]); // let the worker process the enqueued emails
  run("bash", ["-c", `kill -9 ${workerPid} 2>/dev/null || true`]);
  const workerLog = readFileSync(workerLogPath, "utf8");
  const resetToken = (workerLog.match(/reset-password\?token=([0-9a-f]+)/) ?? [])[1];
  if (!resetToken) throw new Error(`expected a password reset link in the worker log, got:\n${workerLog}`);

  const verifyTokenMatch = workerLog.match(/"to":"verifyme@example\.com"[^\n]*verify-email\?token=([0-9a-f]+)/);
  const verifyToken = verifyTokenMatch?.[1];
  if (!verifyToken) throw new Error(`expected a verification link for verifyme@example.com in the worker log, got:\n${workerLog}`);

  const meBeforeVerify = run("curl", ["-s", `${B}/users/me`, "-H", `Authorization: Bearer ${verifymeAccess}`]);
  if (!meBeforeVerify.includes('"email_verified":false')) throw new Error(`expected a freshly registered user to be unverified, got:\n${meBeforeVerify}`);

  const badVerify = run("curl", ["-s", "-w", "HTTPSTATUS:%{http_code}", "-X", "POST", `${B}/auth/verify-email`, ...jsonHeader, "-d", '{"token":"garbage"}']);
  if (status(badVerify) !== "401") throw new Error(`expected 401 verifying with a garbage token, got:\n${badVerify}`);

  const goodVerify = run("curl", ["-s", "-w", "HTTPSTATUS:%{http_code}", "-X", "POST", `${B}/auth/verify-email`, ...jsonHeader, "-d", `{"token":"${verifyToken}"}`]);
  if (status(goodVerify) !== "204") throw new Error(`expected 204 on a valid email verification, got:\n${goodVerify}`);

  const verifyReuse = run("curl", ["-s", "-w", "HTTPSTATUS:%{http_code}", "-X", "POST", `${B}/auth/verify-email`, ...jsonHeader, "-d", `{"token":"${verifyToken}"}`]);
  if (status(verifyReuse) !== "401") throw new Error(`expected 401 reusing an already-consumed verify token (GETDEL is one-time), got:\n${verifyReuse}`);

  const meAfterVerify = run("curl", ["-s", `${B}/users/me`, "-H", `Authorization: Bearer ${verifymeAccess}`]);
  if (!meAfterVerify.includes('"email_verified":true')) throw new Error(`expected the user to show verified after a successful verify-email, got:\n${meAfterVerify}`);

  const resendNoAuth = run("curl", ["-s", "-w", "HTTPSTATUS:%{http_code}", "-X", "POST", `${B}/users/me/resend-verification`]);
  if (status(resendNoAuth) !== "401") throw new Error(`expected 401 resending verification with no token, got:\n${resendNoAuth}`);

  const resendAlreadyVerified = run("curl", ["-s", "-w", "HTTPSTATUS:%{http_code}", "-X", "POST", `${B}/users/me/resend-verification`, "-H", `Authorization: Bearer ${verifymeAccess}`]);
  if (status(resendAlreadyVerified) !== "409" || !resendAlreadyVerified.includes("AUTH_ALREADY_VERIFIED")) {
    throw new Error(`expected 409 AUTH_ALREADY_VERIFIED resending for an already-verified user, got:\n${resendAlreadyVerified}`);
  }

  const resendmeRegister = run("curl", ["-s", "-X", "POST", `${B}/auth/register`, ...jsonHeader, "-d", '{"email":"resendme@example.com","password":"correcthorsebattery","name":"Resend Me"}']);
  const resendmeAccess = field(resendmeRegister, "access_token");
  const resendUnverified = run("curl", ["-s", "-w", "HTTPSTATUS:%{http_code}", "-X", "POST", `${B}/users/me/resend-verification`, "-H", `Authorization: Bearer ${resendmeAccess}`]);
  if (status(resendUnverified) !== "204") throw new Error(`expected 204 resending verification for a not-yet-verified user, got:\n${resendUnverified}`);

  const badReset = run("curl", ["-s", "-w", "HTTPSTATUS:%{http_code}", "-X", "POST", `${B}/auth/reset-password`, ...jsonHeader, "-d", '{"token":"garbage","new_password":"irrelevant123"}']);
  if (status(badReset) !== "401") throw new Error(`expected 401 resetting with a garbage token, got:\n${badReset}`);

  const goodReset = run("curl", ["-s", "-w", "HTTPSTATUS:%{http_code}", "-X", "POST", `${B}/auth/reset-password`, ...jsonHeader, "-d", `{"token":"${resetToken}","new_password":"brandnewpassword123"}`]);
  if (status(goodReset) !== "204") throw new Error(`expected 204 on a valid reset-password, got:\n${goodReset}`);

  const resetReuse = run("curl", ["-s", "-w", "HTTPSTATUS:%{http_code}", "-X", "POST", `${B}/auth/reset-password`, ...jsonHeader, "-d", `{"token":"${resetToken}","new_password":"anotherpassword123"}`]);
  if (status(resetReuse) !== "401") throw new Error(`expected 401 reusing an already-consumed reset token (GETDEL is one-time), got:\n${resetReuse}`);

  const loginOldPassword = run("curl", ["-s", "-w", "HTTPSTATUS:%{http_code}", "-X", "POST", `${B}/auth/login`, ...jsonHeader, "-d", '{"email":"alice@example.com","password":"correcthorsebattery"}']);
  if (status(loginOldPassword) !== "401") throw new Error(`expected 401 logging in with the pre-reset password, got:\n${loginOldPassword}`);

  const loginNewPassword = run("curl", ["-s", "-w", "HTTPSTATUS:%{http_code}", "-X", "POST", `${B}/auth/login`, ...jsonHeader, "-d", '{"email":"alice@example.com","password":"brandnewpassword123"}']);
  if (status(loginNewPassword) !== "200") throw new Error(`expected 200 logging in with the post-reset password, got:\n${loginNewPassword}`);

  rmSync(path.join(fullApp, "auth-worker-bin"), { force: true });
  rmSync(workerLogPath, { force: true });

  // Google OAuth: only what's testable without a live Google app — the login
  // redirect targets Google with a signed state param, and the callback
  // rejects a state that isn't a validly-signed oauth_state JWT.
  const googleLogin = run("curl", ["-s", "-i", `${B}/auth/google/login`]);
  if (!/^HTTP\/1\.1 302/.test(googleLogin)) throw new Error(`expected 302 on GET /auth/google/login, got:\n${googleLogin}`);
  if (!/Location: https:\/\/accounts\.google\.com\/.*state=/.test(googleLogin)) {
    throw new Error(`expected a redirect to accounts.google.com with a state param, got:\n${googleLogin}`);
  }
  const googleCallbackBadState = run("curl", ["-s", "-w", "HTTPSTATUS:%{http_code}", `${B}/auth/google/callback?code=fake&state=garbage`]);
  if (status(googleCallbackBadState) !== "401") throw new Error(`expected 401 on google callback with an invalid state, got:\n${googleCallbackBadState}`);

  const logout = run("curl", ["-s", "-w", "HTTPSTATUS:%{http_code}", "-X", "POST", `${B}/auth/logout`, "-H", `Cookie: refresh_token=${registerCookie}`]);
  if (status(logout) !== "204") throw new Error(`expected 204 on logout, got:\n${logout}`);
  const logoutAgain = run("curl", ["-s", "-w", "HTTPSTATUS:%{http_code}", "-X", "POST", `${B}/auth/logout`, "-H", `Cookie: refresh_token=${registerCookie}`]);
  if (status(logoutAgain) !== "204") throw new Error(`expected logout to be idempotent (204 again), got:\n${logoutAgain}`);
  const refreshAfterLogout = run("curl", ["-s", "-w", "HTTPSTATUS:%{http_code}", "-X", "POST", `${B}/auth/refresh`, "-H", `Cookie: refresh_token=${registerCookie}`]);
  if (status(refreshAfterLogout) !== "401") throw new Error(`expected 401 refreshing after logout, got:\n${refreshAfterLogout}`);

  // Rate limiting: register/login/forgot-password/reset-password are each
  // throttled per-IP via Redis (middleware.RateLimit). Flush the shared
  // Redis first so this doesn't depend on how many times the assertions
  // above already spent the budget (also sidesteps having to guess whether
  // curl-to-localhost counts as client IP 127.0.0.1 or ::1), and flush again
  // after so a budget this test deliberately exhausts doesn't bleed into a
  // later step that shares the same container (e.g. "add rbac"'s own
  // /auth/register call). Safe to nuke everything here — this is the last
  // thing this step does before the server gets killed.
  const resetRateLimits = () => run("docker", ["exec", sharedRedisContainerId, "redis-cli", "FLUSHDB"]);
  resetRateLimits();

  // register is capped at 5/min — fire 6 back-to-back and expect only the 6th to 429.
  for (let i = 1; i <= 6; i++) {
    const out = run("curl", [
      "-s", "-w", "HTTPSTATUS:%{http_code}", "-X", "POST", `${B}/auth/register`, ...jsonHeader,
      "-d", `{"email":"burst${i}@example.com","password":"correcthorsebattery","name":"Burst"}`,
    ]);
    if (i <= 5) {
      if (status(out) === "429") throw new Error(`expected request ${i}/6 to register to stay under the 5/min limit, got 429:\n${out}`);
    } else if (status(out) !== "429" || !out.includes("RATE_LIMITED")) {
      throw new Error(`expected the 6th rapid register within a minute to be rate limited (429 RATE_LIMITED), got:\n${out}`);
    }
  }

  // a DIFFERENT route's budget must be untouched — proves limits are
  // per-route, not one shared global counter.
  const loginStillWorks = run("curl", ["-s", "-w", "HTTPSTATUS:%{http_code}", "-X", "POST", `${B}/auth/login`, ...jsonHeader, "-d", '{"email":"burst1@example.com","password":"correcthorsebattery"}']);
  if (status(loginStillWorks) !== "200") throw new Error(`expected /auth/login to be unaffected by /auth/register's exhausted rate limit, got:\n${loginStillWorks}`);

  resetRateLimits();

  run("bash", ["-c", "lsof -ti:8080 | xargs -r kill -9"]);
  execFileSync("sleep", ["1"]);

  // cmd/seed talks to Postgres directly (config.Load() + database.Open, same
  // as cmd/api) — no server, no Redis, run it as a plain one-shot process.
  const seedOut = run("go", ["run", "./cmd/seed"], fullApp, {
    SEED_ADMIN_EMAIL: "seed-admin@example.com",
    SEED_ADMIN_PASSWORD: "seedpassword123",
    SEED_ADMIN_NAME: "Seed Admin",
  });
  if (!seedOut.includes('"msg":"admin user ready"') || !seedOut.includes("seed-admin@example.com")) {
    throw new Error(`expected cmd/seed to report the admin user ready, got:\n${seedOut}`);
  }
  const seedID = field(seedOut, "id");
  if (!seedID) throw new Error(`expected cmd/seed's log line to include the user id, got:\n${seedOut}`);

  // idempotent: re-running with a DIFFERENT password must return the SAME
  // user id (found, not recreated) rather than a fresh one.
  const seedAgainOut = run("go", ["run", "./cmd/seed"], fullApp, {
    SEED_ADMIN_EMAIL: "seed-admin@example.com",
    SEED_ADMIN_PASSWORD: "a-completely-different-password",
    SEED_ADMIN_NAME: "Seed Admin",
  });
  if (field(seedAgainOut, "id") !== seedID) {
    throw new Error(`expected re-running cmd/seed to return the same user id (idempotent), got:\n${seedAgainOut}\nfirst run:\n${seedOut}`);
  }

  let missingPasswordFailed = false;
  try {
    run("go", ["run", "./cmd/seed"], fullApp, { SEED_ADMIN_EMAIL: "no-password@example.com" });
  } catch {
    missingPasswordFailed = true;
  }
  if (!missingPasswordFailed) throw new Error("expected cmd/seed to exit nonzero when SEED_ADMIN_PASSWORD is missing but SEED_ADMIN_EMAIL is set");

  const fixturesOut = run("go", ["run", "./cmd/seed", "--fixtures"], fullApp);
  if (!fixturesOut.includes("dev.one@example.com") || !fixturesOut.includes("dev.two@example.com")) {
    throw new Error(`expected --fixtures to seed both dev sample users, got:\n${fixturesOut}`);
  }

  run("make", ["db-drop"], fullApp);
});

step(
  hasDocker
    ? "add auth: unit tests cover refresh rotation + reuse-detection (go test ./internal/app/user/...)"
    : "add auth: unit tests skipped (needs Docker for add worker's Redis)",
  () => {
    if (!hasDocker) return;
    run("go", ["test", "./internal/app/user/..."], fullApp);
  }
);

step(hasDocker ? "add auth: wires /auth/* and /users/me* into docs/openapi.yaml, bundle resolves" : "add auth: openapi wiring skipped (needs Docker)", () => {
  if (!hasDocker) return;
  const openapi = readFileSync(path.join(fullApp, "docs", "openapi.yaml"), "utf8");
  for (const p of [
    "/v1/auth/register:",
    "/v1/auth/login:",
    "/v1/auth/refresh:",
    "/v1/auth/logout:",
    "/v1/auth/forgot-password:",
    "/v1/auth/reset-password:",
    "/v1/auth/verify-email:",
    "/v1/auth/google/login:",
    "/v1/auth/google/callback:",
    "/v1/users/me:",
    "/v1/users/me/resend-verification:",
    "/v1/users/me/logout-all:",
  ]) {
    if (!openapi.includes(p)) throw new Error(`expected ${p} in docs/openapi.yaml after add auth, got:\n${openapi}`);
  }
  if (hasNpx) run("npx", ["--yes", "@redocly/cli", "bundle", "docs/openapi.yaml", "-o", "docs/openapi.bundled.yaml"], fullApp);
});

step("bare project: CI workflow renders with the right db name, valid trigger keys", () => {
  assertFileContains(path.join(fullApp, ".github", "workflows", "ci.yml"), "POSTGRES_DB: full_app_test");
  assertFileContains(path.join(fullApp, ".github", "workflows", "ci.yml"), "golangci-lint-action");
});

let hasGolangciLint = true;
try {
  run("golangci-lint", ["--version"]);
  // golangci-lint's result cache is keyed by file content, not absolute path —
  // this suite regenerates byte-identical "widget"/"order" packages across many
  // scratch dirs, so a stale cache entry (e.g. from before a template fix) can
  // get served with a file path from a since-deleted run. Start from empty.
  run("golangci-lint", ["cache", "clean"]);
} catch {
  hasGolangciLint = false;
}

step(
  hasGolangciLint
    ? "bare project: golangci-lint is clean out of the box (the CI gate the scaffold ships would pass)"
    : "bare project: golangci-lint not installed locally — skipping a real run",
  () => {
    if (!hasGolangciLint) return;
    const out = run("golangci-lint", ["run"], fullApp);
    if (out.trim() && !out.includes("0 issues")) throw new Error(`expected 0 issues, got:\n${out}`);
  }
);

let hasPsql = true;
try {
  run("psql", ["--version"]);
} catch {
  hasPsql = false;
}

let dockerPgContainer = null;
if (!hasPsql) {
  try {
    dockerPgContainer = run("docker", ["ps", "-q", "--filter", "publish=5432"]).trim().split("\n")[0] || null;
  } catch {
    dockerPgContainer = null;
  }
}

function listDatabases() {
  return hasPsql
    ? run("psql", ["-h", "localhost", "-U", "postgres", "-lqt"], undefined, { PGPASSWORD: "postgres" })
    : run("docker", ["exec", "-e", "PGPASSWORD=postgres", dockerPgContainer, "psql", "-U", "postgres", "-lqt"]);
}

function psqlExec(db, sql) {
  return hasPsql
    ? run("psql", ["-h", "localhost", "-U", "postgres", "-d", db, "-tAc", sql], undefined, { PGPASSWORD: "postgres" })
    : run("docker", [
        "exec",
        "-e",
        "PGPASSWORD=postgres",
        dockerPgContainer,
        "psql",
        "-U",
        "postgres",
        "-d",
        db,
        "-tAc",
        sql,
      ]);
}

step(
  hasPsql
    ? "make db-create is idempotent and actually creates the DB"
    : dockerPgContainer
      ? "make db-create falls back to docker exec (no local psql) and actually creates the DB"
      : "make db-create parses (no psql, no Postgres container — skipping a real run)",
  () => {
    if (!hasPsql && !dockerPgContainer) {
      run("make", ["-n", "db-create"], fullApp); // dry run: catches Makefile/shell syntax errors
      return;
    }
    run("make", ["db-drop"], fullApp); // start from a clean slate in case a prior run left it
    run("make", ["db-create"], fullApp);
    run("make", ["db-create"], fullApp); // must not error the second time
    const list = listDatabases();
    if (!list.includes("full_app")) throw new Error(`expected database "full_app" to exist, got:\n${list}`);
    run("make", ["db-drop"], fullApp);
  }
);

// middleware.CORS's whole point: "*" can't be combined with Allow-Credentials
// per the fetch spec, so an allowed origin is echoed back explicitly and a
// disallowed one gets nothing — proven against the real compiled server, not
// just the middleware in isolation.
step(
  hasPsql || dockerPgContainer
    ? "CORS: an allowed origin gets the full header set, a disallowed one gets none"
    : "CORS: skipped (needs psql/a Postgres container)",
  () => {
    if (!hasPsql && !dockerPgContainer) return;
    run("make", ["db-drop"], fullApp); // clean slate
    run("make", ["db-create"], fullApp);

    const out = run(
      "bash",
      [
        "-c",
        // fullApp already has cache/redis wired into readyz once "add worker"
        // has run earlier in this suite (same shared scratch project) —
        // needs REDIS_URL too, or the server never becomes ready to answer
        // anything, CORS included.
        `REDIS_URL='${sharedRedisUrl}' go run ./cmd/api >/tmp/go-scaffold-smoke-cors.log 2>&1 & sleep 3; ` +
          "echo '===ALLOWED==='; " +
          "curl -s -i -X OPTIONS http://localhost:8080/livez -H 'Origin: http://localhost:3000' -H 'Access-Control-Request-Method: GET'; " +
          "echo '===DISALLOWED==='; " +
          "curl -s -i -X OPTIONS http://localhost:8080/livez -H 'Origin: http://evil.example' -H 'Access-Control-Request-Method: GET'; " +
          "lsof -ti:8080 | xargs -r kill -9",
      ],
      fullApp
    );
    const [, allowed = "", disallowed = ""] = out.split(/===ALLOWED===|===DISALLOWED===/);

    if (!/HTTP\/1\.1 204/.test(allowed)) throw new Error(`expected 204 on the allowed-origin preflight, got:\n${allowed}`);
    if (!allowed.includes("Access-Control-Allow-Origin: http://localhost:3000")) {
      throw new Error(`expected Allow-Origin echoed back for an allowed origin, got:\n${allowed}`);
    }
    if (!allowed.includes("Access-Control-Allow-Credentials: true")) {
      throw new Error(`expected Allow-Credentials for an allowed origin, got:\n${allowed}`);
    }

    if (!/HTTP\/1\.1 204/.test(disallowed)) throw new Error(`expected 204 on the disallowed-origin preflight too, got:\n${disallowed}`);
    if (disallowed.includes("Access-Control-Allow-Origin")) {
      throw new Error(`expected no Allow-Origin at all for a disallowed origin, got:\n${disallowed}`);
    }

    run("make", ["db-drop"], fullApp);
  }
);

step("generate migration reserves a timestamped up/down pair, TODO-stubbed", () => {
  goScaffold(["generate", "migration", "add_status_to_orders"], fullApp);
  const files = readdirSync(path.join(fullApp, "migrations")).filter((f) => f.includes("add_status_to_orders"));
  if (files.length !== 2) throw new Error(`expected exactly 2 files (up+down), got: ${files.join(", ")}`);
  if (!files.every((f) => /^\d{14}_add_status_to_orders\.(up|down)\.sql$/.test(f))) {
    throw new Error(`expected a 14-digit timestamp prefix, got: ${files.join(", ")}`);
  }
  const upContent = readFileSync(
    path.join(fullApp, "migrations", files.find((f) => f.endsWith(".up.sql"))),
    "utf8"
  );
  if (!upContent.includes("TODO")) throw new Error(`expected a TODO stub in the up migration, got:\n${upContent}`);
});

let hasMigrate = true;
try {
  run("migrate", ["-version"]);
} catch {
  hasMigrate = false;
}

// Two things at once: (1) a project with old-style sequential migrations
// (0000NN_*, from before this convention) still applies cleanly alongside a
// newly generated timestamped one, in the right order — proven against the
// real migrate CLI, not just this repo's own string-sorting assumptions; (2)
// `make migrate-verify` (up -> down -all -> up) round-trips without error.
step(
  (hasPsql || dockerPgContainer) && hasMigrate
    ? "a legacy sequential migration and a new timestamped one apply in order; migrate-verify round-trips"
    : "migration ordering / migrate-verify: skipped (needs psql/a Postgres container, and the migrate CLI)",
  () => {
    if (!((hasPsql || dockerPgContainer) && hasMigrate)) return;

    writeFileSync(path.join(fullApp, "migrations", "000001_create_legacy.up.sql"), "CREATE TABLE legacy (id uuid PRIMARY KEY);\n");
    writeFileSync(path.join(fullApp, "migrations", "000001_create_legacy.down.sql"), "DROP TABLE legacy;\n");

    run("make", ["db-drop"], fullApp);
    run("make", ["db-create"], fullApp);
    const dsn = "postgres://postgres:postgres@localhost:5432/full_app?sslmode=disable";

    // migrate logs each applied step to stderr, not stdout — merge via bash so
    // `run`'s stdout-only capture actually sees it.
    const upOut = run("bash", ["-c", `migrate -path migrations -database '${dsn}' up 2>&1`], fullApp);
    if (!/^1\/u create_legacy/m.test(upOut) || !upOut.includes("add_status_to_orders")) {
      throw new Error(`expected both the legacy migration and the new one to apply, in order, got:\n${upOut}`);
    }

    const version = psqlExec("full_app", "SELECT version FROM schema_migrations;").trim();
    if (!/^\d{14}$/.test(version)) {
      throw new Error(`expected schema_migrations to land on the 14-digit timestamped migration, got: "${version}"`);
    }

    run("bash", ["-c", `DB_DSN="${dsn}" make migrate-verify`], fullApp);

    // migrate-verify's whole point: catch a down.sql that's stopped reversing
    // cleanly. A check that only exercises the happy path above would still
    // pass even if the down step were silently skipped — corrupt one and
    // confirm the target actually fails instead of succeeding anyway. Ends
    // "up" after the run above, so this second call's down-all step is the
    // first thing to touch the corrupted file.
    writeFileSync(path.join(fullApp, "migrations", "000001_create_legacy.down.sql"), "DROP TABLE this_table_does_not_exist;\n");
    let verifyCaughtTheBreak = false;
    try {
      run("bash", ["-c", `DB_DSN="${dsn}" make migrate-verify`], fullApp);
    } catch {
      verifyCaughtTheBreak = true;
    }
    if (!verifyCaughtTheBreak) throw new Error("expected migrate-verify to fail against a broken down.sql, it succeeded");

    run("make", ["db-drop"], fullApp);
  }
);

// `add rbac` requires real seed data (roles/permissions rows), which only
// the SQL migration provides — AUTO_MIGRATE=true creates the tables via
// AutoMigrate but never runs the migration's INSERT statements, so this
// step applies the real migration via the `migrate` CLI rather than
// AUTO_MIGRATE=true like earlier steps.
step(
  hasDocker && (hasPsql || dockerPgContainer) && hasMigrate
    ? "add rbac: default role, list/view/set-role admin routes, last-role-manager lockout guard, configurable authz cache TTL, logout-all, cmd/seed promotes to admin"
    : "add rbac: skipped (needs Docker, psql/a Postgres container, and the migrate CLI)",
  () => {
    if (!(hasDocker && (hasPsql || dockerPgContainer) && hasMigrate)) return;

    const rbacOut = goScaffold(["add", "rbac"], fullApp);
    // AUTO_MIGRATE=true creates the tables but never runs the migration's
    // seed INSERTs — a dev following the normal AUTO_MIGRATE=true dev flow
    // would otherwise hit "unknown role code" from `make seed` with no clue
    // why, so `add rbac` must say so loudly, not just in a doc.
    if (!rbacOut.includes("AUTO_MIGRATE=true") || !rbacOut.includes("does NOT seed")) {
      throw new Error(`expected \`add rbac\` to warn that AUTO_MIGRATE=true doesn't seed role/permission data, got:\n${rbacOut}`);
    }
    run("go", ["mod", "tidy"], fullApp);
    run("go", ["build", "./..."], fullApp);
    run("go", ["vet", "./..."], fullApp);

    run("make", ["db-drop"], fullApp);
    run("make", ["db-create"], fullApp);
    const dsn = "postgres://postgres:postgres@localhost:5432/full_app?sslmode=disable";
    run("migrate", ["-path", "migrations", "-database", dsn, "up"], fullApp);

    // also proves SetRole works standalone (not just reachable via HTTP)
    run("go", ["run", "./cmd/seed"], fullApp, {
      SEED_ADMIN_EMAIL: "rbac-admin@example.com",
      SEED_ADMIN_PASSWORD: "adminpassword123",
      SEED_ADMIN_NAME: "RBAC Admin",
    });

    // AUTHZ_CACHE_TTL_MIN=0 (vs. the .env.example default of 1) proves the
    // value is actually threaded through config -> main.go -> NewAuthz, not
    // just accepted and ignored — a permission grant takes effect on the
    // very next request instead of needing to wait out any cache window.
    run("bash", ["-c", `REDIS_URL='${sharedRedisUrl}' AUTO_MIGRATE=false AUTHZ_CACHE_TTL_MIN=0 go run ./cmd/api >/tmp/go-scaffold-smoke-rbac-boot.log 2>&1 & sleep 3`], fullApp);

    const B = "http://localhost:8080/v1";
    const jsonHeader = ["-H", "Content-Type: application/json"];
    const status = (out) => (out.match(/HTTPSTATUS:(\d+)/) ?? [])[1];
    const field = (out, key) => (out.match(new RegExp(`"${key}":"([^"]*)"`)) ?? [])[1];

    const staffRegister = run("curl", ["-s", "-X", "POST", `${B}/auth/register`, ...jsonHeader, "-d", '{"email":"rbac-staff@example.com","password":"correcthorsebattery","name":"Staff"}']);
    const staffAccess = field(staffRegister, "access_token");
    if (!staffAccess) throw new Error(`expected an access token on register, got:\n${staffRegister}`);

    const staffMe = run("curl", ["-s", `${B}/users/me`, "-H", `Authorization: Bearer ${staffAccess}`]);
    if (!staffMe.includes('"role":"staff"')) throw new Error(`expected a freshly registered user's default role to be "staff", got:\n${staffMe}`);
    const staffID = field(staffMe, "id");

    const noAuthRoles = run("curl", ["-s", "-w", "HTTPSTATUS:%{http_code}", `${B}/roles`]);
    if (status(noAuthRoles) !== "401") throw new Error(`expected 401 (not 403) listing /roles unauthenticated, got:\n${noAuthRoles}`);

    const staffForbidden = run("curl", ["-s", "-w", "HTTPSTATUS:%{http_code}", `${B}/roles`, "-H", `Authorization: Bearer ${staffAccess}`]);
    if (status(staffForbidden) !== "403") throw new Error(`expected 403 listing /roles as staff (no role:manage granted), got:\n${staffForbidden}`);

    const adminLogin = run("curl", ["-s", "-X", "POST", `${B}/auth/login`, ...jsonHeader, "-d", '{"email":"rbac-admin@example.com","password":"adminpassword123"}']);
    const adminAccess = field(adminLogin, "access_token");
    if (!adminAccess) throw new Error(`expected the seeded admin to log in, got:\n${adminLogin}`);

    const adminRoles = run("curl", ["-s", "-w", "HTTPSTATUS:%{http_code}", `${B}/roles`, "-H", `Authorization: Bearer ${adminAccess}`]);
    if (status(adminRoles) !== "200" || !adminRoles.includes('"code":"admin"') || !adminRoles.includes('"code":"staff"')) {
      throw new Error(`expected the admin to list both seeded roles, got:\n${adminRoles}`);
    }

    // the trickiest business rule here: revoking role:manage from the only
    // role that grants it must be blocked, or an admin could lock everyone
    // (including themselves) out of role management with no way back in.
    const lastManager = run("curl", [
      "-s", "-w", "HTTPSTATUS:%{http_code}", "-X", "PATCH", `${B}/roles/admin/permissions`,
      "-H", `Authorization: Bearer ${adminAccess}`, ...jsonHeader, "-d", '{"permission_codes":["user:manage-role"]}',
    ]);
    if (status(lastManager) !== "409" || !lastManager.includes("ROLE_LAST_MANAGER")) {
      throw new Error(`expected 409 ROLE_LAST_MANAGER revoking role:manage from the only manager, got:\n${lastManager}`);
    }

    const promote = run("curl", [
      "-s", "-w", "HTTPSTATUS:%{http_code}", "-X", "PATCH", `${B}/users/${staffID}/set-role`,
      "-H", `Authorization: Bearer ${adminAccess}`, ...jsonHeader, "-d", '{"role":"admin"}',
    ]);
    if (status(promote) !== "200" || !promote.includes('"role":"admin"')) {
      throw new Error(`expected 200 with role "admin" after set-role, got:\n${promote}`);
    }

    const unknownRole = run("curl", [
      "-s", "-w", "HTTPSTATUS:%{http_code}", "-X", "PATCH", `${B}/users/${staffID}/set-role`,
      "-H", `Authorization: Bearer ${adminAccess}`, ...jsonHeader, "-d", '{"role":"superuser"}',
    ]);
    if (status(unknownRole) !== "422" || !unknownRole.includes("USER_UNKNOWN_ROLE")) {
      throw new Error(`expected 422 USER_UNKNOWN_ROLE for an unknown role code, got:\n${unknownRole}`);
    }

    // the promoted user's role only changes in a FRESH token — the JWT is
    // stateless, so a re-login (or refresh) is what actually applies it.
    const promotedLogin = run("curl", ["-s", "-X", "POST", `${B}/auth/login`, ...jsonHeader, "-d", '{"email":"rbac-staff@example.com","password":"correcthorsebattery"}']);
    const promotedAccess = field(promotedLogin, "access_token");
    const promotedRoles = run("curl", ["-s", "-w", "HTTPSTATUS:%{http_code}", `${B}/roles`, "-H", `Authorization: Bearer ${promotedAccess}`]);
    if (status(promotedRoles) !== "200") throw new Error(`expected the promoted user's new token to grant /roles access, got:\n${promotedRoles}`);

    // GET /users, GET /users/:id — admin can't manage anyone through the API
    // without a way to find their id first; staffID above got promoted to
    // admin already, so register a fresh unprivileged user for the 403 checks.
    const staff2Register = run("curl", ["-s", "-X", "POST", `${B}/auth/register`, ...jsonHeader, "-d", '{"email":"rbac-staff2@example.com","password":"correcthorsebattery","name":"Staff Two"}']);
    const staff2Access = field(staff2Register, "access_token");
    if (!staff2Access) throw new Error(`expected an access token registering a second staff user, got:\n${staff2Register}`);

    const noAuthUsers = run("curl", ["-s", "-w", "HTTPSTATUS:%{http_code}", `${B}/users`]);
    if (status(noAuthUsers) !== "401") throw new Error(`expected 401 (not 403) listing /users unauthenticated, got:\n${noAuthUsers}`);

    const staff2Forbidden = run("curl", ["-s", "-w", "HTTPSTATUS:%{http_code}", `${B}/users`, "-H", `Authorization: Bearer ${staff2Access}`]);
    if (status(staff2Forbidden) !== "403") throw new Error(`expected 403 listing /users as staff (no user:read granted), got:\n${staff2Forbidden}`);

    const adminUsers = run("curl", ["-s", "-w", "HTTPSTATUS:%{http_code}", `${B}/users`, "-H", `Authorization: Bearer ${adminAccess}`]);
    if (status(adminUsers) !== "200" || !adminUsers.includes("rbac-staff2@example.com")) {
      throw new Error(`expected the admin to list users including the freshly registered one (user:read auto-granted from the same seed migration), got:\n${adminUsers}`);
    }

    const adminGetByID = run("curl", ["-s", "-w", "HTTPSTATUS:%{http_code}", `${B}/users/${staffID}`, "-H", `Authorization: Bearer ${adminAccess}`]);
    if (status(adminGetByID) !== "200") throw new Error(`expected 200 viewing a specific user by id as admin, got:\n${adminGetByID}`);

    const adminGetMissing = run("curl", ["-s", "-w", "HTTPSTATUS:%{http_code}", `${B}/users/00000000-0000-0000-0000-000000000000`, "-H", `Authorization: Bearer ${adminAccess}`]);
    if (status(adminGetMissing) !== "404") throw new Error(`expected 404 for a well-formed but nonexistent user id, got:\n${adminGetMissing}`);

    const adminGetInvalid = run("curl", ["-s", "-w", "HTTPSTATUS:%{http_code}", `${B}/users/not-a-uuid`, "-H", `Authorization: Bearer ${adminAccess}`]);
    if (status(adminGetInvalid) !== "400") throw new Error(`expected 400 for a malformed user id, got:\n${adminGetInvalid}`);

    const staff2GetByID = run("curl", ["-s", "-w", "HTTPSTATUS:%{http_code}", `${B}/users/${staffID}`, "-H", `Authorization: Bearer ${staff2Access}`]);
    if (status(staff2GetByID) !== "403") throw new Error(`expected 403 viewing another user by id as staff (no user:read granted), got:\n${staff2GetByID}`);

    // /me must be completely unaffected by adding /users and /users/:id next to it.
    const staff2Me = run("curl", ["-s", "-w", "HTTPSTATUS:%{http_code}", `${B}/users/me`, "-H", `Authorization: Bearer ${staff2Access}`]);
    if (status(staff2Me) !== "200") throw new Error(`expected /users/me to still work unaffected by the new /users routes, got:\n${staff2Me}`);

    // authz cache TTL: grant "staff" the permission it was just denied above
    // and confirm it takes effect on the very next request — this server was
    // booted with AUTHZ_CACHE_TTL_MIN=0, so there's no window to wait out.
    const grantStaffRead = run("curl", [
      "-s", "-w", "HTTPSTATUS:%{http_code}", "-X", "PATCH", `${B}/roles/staff/permissions`,
      "-H", `Authorization: Bearer ${adminAccess}`, ...jsonHeader, "-d", '{"permission_codes":["user:read"]}',
    ]);
    if (status(grantStaffRead) !== "200") throw new Error(`expected 200 granting user:read to the staff role, got:\n${grantStaffRead}`);
    const staff2AfterGrant = run("curl", ["-s", "-w", "HTTPSTATUS:%{http_code}", `${B}/users`, "-H", `Authorization: Bearer ${staff2Access}`]);
    if (status(staff2AfterGrant) !== "200") {
      throw new Error(`expected the staff role's new permission to apply immediately with AUTHZ_CACHE_TTL_MIN=0, got:\n${staff2AfterGrant}`);
    }

    // logout-all: revoking through ONE session's token must kill every
    // session for that user, not just the one making the request. Session 1
    // (register) supplies the access token that calls logout-all; session 2
    // (a separate login) is the "other device" whose refresh cookie should
    // die too, even though logout-all never sees its cookie at all.
    const laRegister = run("curl", ["-s", "-X", "POST", `${B}/auth/register`, ...jsonHeader, "-d", '{"email":"rbac-logoutall@example.com","password":"correcthorsebattery","name":"Logout All"}']);
    const laAccess1 = field(laRegister, "access_token");
    const laLoginFull = run("curl", ["-s", "-i", "-X", "POST", `${B}/auth/login`, ...jsonHeader, "-d", '{"email":"rbac-logoutall@example.com","password":"correcthorsebattery"}']);
    const laCookie2 = (laLoginFull.match(/Set-Cookie: refresh_token=([^;]*);/) ?? [])[1];
    if (!laAccess1 || !laCookie2) throw new Error(`expected an access token and a second session's refresh cookie for the logout-all test, got register:\n${laRegister}\nand login:\n${laLoginFull}`);

    const noAuthLogoutAll = run("curl", ["-s", "-w", "HTTPSTATUS:%{http_code}", "-X", "POST", `${B}/users/me/logout-all`]);
    if (status(noAuthLogoutAll) !== "401") throw new Error(`expected 401 calling logout-all with no token, got:\n${noAuthLogoutAll}`);

    const logoutAll = run("curl", ["-s", "-w", "HTTPSTATUS:%{http_code}", "-X", "POST", `${B}/users/me/logout-all`, "-H", `Authorization: Bearer ${laAccess1}`]);
    if (status(logoutAll) !== "204") throw new Error(`expected 204 from logout-all, got:\n${logoutAll}`);

    const refreshOtherSessionAfterLogoutAll = run("curl", ["-s", "-w", "HTTPSTATUS:%{http_code}", "-X", "POST", `${B}/auth/refresh`, "-H", `Cookie: refresh_token=${laCookie2}`]);
    if (status(refreshOtherSessionAfterLogoutAll) !== "401") {
      throw new Error(`expected logout-all (called from session 1, no cookie needed) to also kill session 2's refresh token, got:\n${refreshOtherSessionAfterLogoutAll}`);
    }

    run("bash", ["-c", "lsof -ti:8080 | xargs -r kill -9"]);
    execFileSync("sleep", ["1"]);
    run("make", ["db-drop"], fullApp);
  }
);

step(
  hasDocker && (hasPsql || dockerPgContainer) && hasMigrate
    ? "add rbac: wires /roles, /permissions, /users(/{id}) into docs/openapi.yaml, patches MeResponse.role, bundle resolves"
    : "add rbac: openapi wiring skipped (needs Docker, psql/a Postgres container, and the migrate CLI)",
  () => {
    if (!(hasDocker && (hasPsql || dockerPgContainer) && hasMigrate)) return;
    const openapi = readFileSync(path.join(fullApp, "docs", "openapi.yaml"), "utf8");
    for (const p of ["/v1/roles:", "/v1/roles/{code}/permissions:", "/v1/roles/{code}:", "/v1/permissions:", "/v1/users:", "/v1/users/{id}:", "/v1/users/{id}/set-role:"]) {
      if (!openapi.includes(p)) throw new Error(`expected ${p} in docs/openapi.yaml after add rbac, got:\n${openapi}`);
    }
    assertFileContains(path.join(fullApp, "docs", "auth", "schemas.yaml"), "role: { type: string }");
    if (hasNpx) run("npx", ["--yes", "@redocly/cli", "bundle", "docs/openapi.yaml", "-o", "docs/openapi.bundled.yaml"], fullApp);
  }
);

step(
  hasDocker && (hasPsql || dockerPgContainer) && hasMigrate
    ? "add rbac: unit tests cover the last-role-manager lockout guard and the Authz permission cache (hit/TTL-expiry, go test)"
    : "add rbac: unit tests skipped (needs Docker, psql/a Postgres container, and the migrate CLI)",
  () => {
    if (!(hasDocker && (hasPsql || dockerPgContainer) && hasMigrate)) return;
    run("go", ["test", "./internal/app/role/...", "./internal/shared/middleware/..."], fullApp);
  }
);

// generate module --auth [--permission <code>]: without this, every module
// this suite generates from here on would be reachable with no token at all
// even though fullApp already has auth+rbac installed — the exact gap this
// flag exists to close.
step(
  hasDocker && (hasPsql || dockerPgContainer) && hasMigrate
    ? "generate module --auth [--permission]: wires RequireAuth/authz.Require, validates flag combos, seeds the permission"
    : "generate module --auth: skipped (needs Docker, psql/a Postgres container, and the migrate CLI)",
  () => {
    if (!(hasDocker && (hasPsql || dockerPgContainer) && hasMigrate)) return;

    // --permission without --auth must be rejected before anything is written.
    expectThrows(() => goScaffold(["generate", "module", "shouldfail", "--permission", "shouldfail:manage"], fullApp), "--permission requires --auth");
    if (existsSync(path.join(fullApp, "internal", "app", "shouldfail"))) {
      throw new Error("expected the rejected --permission-without-auth call to write nothing");
    }

    // invalid permission code shape.
    expectThrows(() => goScaffold(["generate", "module", "shouldfail2", "--auth", "--permission", "Not Valid"], fullApp), "invalid permission code");

    goScaffold(["generate", "module", "cart", "--auth"], fullApp);
    goScaffold(["generate", "module", "secret", "--auth", "--permission", "secret:manage"], fullApp);
    const noteOut = goScaffold(["generate", "module", "note"], fullApp);
    if (!noteOut.includes("PUBLIC")) throw new Error(`expected a PUBLIC-route reminder since fullApp already has auth installed, got:\n${noteOut}`);

    assertFileContains(path.join(fullApp, "internal", "app", "cart", "handler.go"), "middleware.RequireAuth(h.jwtSecret)");
    assertFileContains(path.join(fullApp, "internal", "app", "secret", "handler.go"), 'h.authz.Require("secret:manage")');

    const permMigration = readdirSync(path.join(fullApp, "migrations")).find((f) => f.endsWith("_add_secrets_permission.up.sql"));
    if (!permMigration) throw new Error("expected a *_add_secrets_permission.up.sql migration to be generated");
    assertFileContains(path.join(fullApp, "migrations", permMigration), "secret:manage");

    run("go", ["build", "./..."], fullApp);
    run("go", ["vet", "./..."], fullApp);

    run("make", ["db-drop"], fullApp);
    run("make", ["db-create"], fullApp);
    const dsn = "postgres://postgres:postgres@localhost:5432/full_app?sslmode=disable";
    run("migrate", ["-path", "migrations", "-database", dsn, "up"], fullApp);

    run("go", ["run", "./cmd/seed"], fullApp, {
      SEED_ADMIN_EMAIL: "genmod-admin@example.com",
      SEED_ADMIN_PASSWORD: "adminpassword123",
      SEED_ADMIN_NAME: "Genmod Admin",
    });

    run("bash", ["-c", `REDIS_URL='${sharedRedisUrl}' AUTO_MIGRATE=false go run ./cmd/api >/tmp/go-scaffold-smoke-genmod-boot.log 2>&1 & sleep 3`], fullApp);

    const B = "http://localhost:8080/v1";
    const jsonHeader = ["-H", "Content-Type: application/json"];
    const status = (out) => (out.match(/HTTPSTATUS:(\d+)/) ?? [])[1];
    const field = (out, key) => (out.match(new RegExp(`"${key}":"([^"]*)"`)) ?? [])[1];

    const noAuthCart = run("curl", ["-s", "-w", "HTTPSTATUS:%{http_code}", "-X", "POST", `${B}/carts`, ...jsonHeader, "-d", "{}"]);
    if (status(noAuthCart) !== "401") throw new Error(`expected 401 posting to an --auth-only module with no token, got:\n${noAuthCart}`);

    const staffRegister = run("curl", ["-s", "-X", "POST", `${B}/auth/register`, ...jsonHeader, "-d", '{"email":"genmod-staff@example.com","password":"correcthorsebattery","name":"Staff"}']);
    const staffAccess = field(staffRegister, "access_token");
    if (!staffAccess) throw new Error(`expected an access token registering the staff user, got:\n${staffRegister}`);

    const staffCart = run("curl", ["-s", "-w", "HTTPSTATUS:%{http_code}", "-X", "POST", `${B}/carts`, ...jsonHeader, "-H", `Authorization: Bearer ${staffAccess}`, "-d", "{}"]);
    if (status(staffCart) !== "201") throw new Error(`expected 201 posting to an --auth-only module with a valid token (no specific permission needed), got:\n${staffCart}`);

    const staffSecret = run("curl", ["-s", "-w", "HTTPSTATUS:%{http_code}", "-X", "POST", `${B}/secrets`, ...jsonHeader, "-H", `Authorization: Bearer ${staffAccess}`, "-d", "{}"]);
    if (status(staffSecret) !== "403") throw new Error(`expected 403 posting to a --permission-gated module as staff (no secret:manage granted), got:\n${staffSecret}`);

    const adminLogin = run("curl", ["-s", "-X", "POST", `${B}/auth/login`, ...jsonHeader, "-d", '{"email":"genmod-admin@example.com","password":"adminpassword123"}']);
    const adminAccess = field(adminLogin, "access_token");
    const adminSecretBeforeGrant = run("curl", ["-s", "-w", "HTTPSTATUS:%{http_code}", "-X", "POST", `${B}/secrets`, ...jsonHeader, "-H", `Authorization: Bearer ${adminAccess}`, "-d", "{}"]);
    if (status(adminSecretBeforeGrant) !== "403") {
      throw new Error(`expected 403 even for the seeded admin — the permission exists but isn't auto-granted to any role, got:\n${adminSecretBeforeGrant}`);
    }

    run("bash", ["-c", "lsof -ti:8080 | xargs -r kill -9"]);
    execFileSync("sleep", ["1"]);
    run("make", ["db-drop"], fullApp);
  }
);

step("generate module order (full CRUD)", () => {
  goScaffold(["generate", "module", "order"], fullApp);
});

step("full module: docs wired into openapi.yaml", () => {
  assertFileContains(path.join(fullApp, "docs", "openapi.yaml"), "/v1/orders:");
  assertFileContains(path.join(fullApp, "docs", "openapi.yaml"), "OrderResponse");
});

step("main.go serves the whole docs/ tree, not just the index (or $ref resolution 404s over HTTP)", () => {
  assertFileContains(path.join(fullApp, "cmd", "api", "main.go"), 'r.Static("/docs", "./docs")');
});

step(
  hasNpx
    ? "make openapi-bundle resolves every $ref into one file (for importers like Bruno that don't)"
    : "make openapi-bundle skipped (npx not available)",
  () => {
    if (!hasNpx) return;
    run("make", ["openapi-bundle"], fullApp);
    const bundlePath = path.join(fullApp, "docs", "openapi.bundled.yaml");
    assertFileContains(bundlePath, "get:");
    assertFileContains(bundlePath, "post:");
    // the whole point: no $ref left pointing at a sibling file
    const bundled = readFileSync(bundlePath, "utf8");
    if (bundled.includes("$ref: './")) throw new Error("bundled spec still has unresolved external $refs");
  }
);

step("re-generating after deleting only the folder doesn't duplicate wiring (would panic gin)", () => {
  // simulate: user rm -rf's the module dir but main.go/openapi.yaml still
  // reference it, then re-runs generate module. Must stay a single Register.
  rmSync(path.join(fullApp, "internal", "app", "order"), { recursive: true, force: true });
  goScaffold(["generate", "module", "order"], fullApp);
  const mainGo = readFileSync(path.join(fullApp, "cmd", "api", "main.go"), "utf8");
  const registers = (mainGo.match(/order\.NewHandler\(/g) ?? []).length;
  if (registers !== 1) throw new Error(`expected exactly 1 order route registration, got ${registers}`);
  const openapi = readFileSync(path.join(fullApp, "docs", "openapi.yaml"), "utf8");
  const paths = (openapi.match(/\/v1\/orders:/g) ?? []).length;
  if (paths !== 1) throw new Error(`expected exactly 1 /v1/orders path in openapi.yaml, got ${paths}`);
  const migrations = readdirSync(path.join(fullApp, "migrations")).filter((f) => f.endsWith("_create_orders.up.sql")).length;
  if (migrations !== 1) throw new Error(`expected exactly 1 create_orders migration, got ${migrations}`);
});

step("full module: build + vet + gofmt clean", () => {
  run("go", ["build", "./..."], fullApp);
  run("go", ["vet", "./..."], fullApp);
  const dirty = run("gofmt", ["-l", "."], fullApp).trim();
  if (dirty) throw new Error(`gofmt found unformatted files:\n${dirty}`);
});

step("full module: go test ./... (integration tests skip without a DB)", () => {
  run("go", ["test", "./..."], fullApp);
});

// The harness in handler_test.go does DropTable+AutoMigrate on whatever DSN it
// gets. Pointed at the app's own database that destroys the schema `migrate up`
// built — FK constraints and seed data included — so the default has to be a
// separate <db>_test. This is the check that the default actually holds.
step(
  hasPsql || dockerPgContainer
    ? "go test wipes only <db>_test, never the app's own database"
    : "go test DB isolation: skipped (no psql, no Postgres container)",
  () => {
    if (!hasPsql && !dockerPgContainer) return;
    // stand up a "dev database" that looks like one `make migrate-up` produced,
    // holding a row the test run must not be allowed to destroy
    run("make", ["db-create"], fullApp);
    psqlExec("full_app", "CREATE TABLE orders (id uuid PRIMARY KEY); INSERT INTO orders VALUES (gen_random_uuid());");
    run("make", ["db-create", "DB_NAME=full_app_test"], fullApp);

    // -count=1 defeats the test cache: the step above already ran `go test ./...`
    // with the same inputs (and TEST_DB_DSN unset both times), so a plain re-run
    // is served from cache and never touches Postgres at all — which would make
    // this whole check pass without proving anything.
    run("go", ["test", "-count=1", "./..."], fullApp); // TEST_DB_DSN unset — the default is what's under test

    const rows = psqlExec("full_app", "SELECT count(*) FROM orders;").trim();
    if (rows !== "1") {
      throw new Error(`the app's database lost data to the test run (expected 1 row, got "${rows}")`);
    }
    run("make", ["db-drop"], fullApp);
    run("make", ["db-drop", "DB_NAME=full_app_test"], fullApp);
  }
);

// The whole point of CheckMigrationVersion: AUTO_MIGRATE=false must not boot
// against a DB nothing has migrated yet, and must boot fine once `migrate up`
// has actually run — proven here against the real compiled server, not just a
// unit test of the function. Invokes `migrate` directly rather than through
// `make migrate-up`, so this step exercises only this PR's own code.
step(
  (hasPsql || dockerPgContainer) && hasMigrate
    ? "AUTO_MIGRATE=false refuses to boot with no migrations applied, boots once `migrate up` has run"
    : "migration guard: skipped (needs psql/a Postgres container, and the migrate CLI)",
  () => {
    if (!((hasPsql || dockerPgContainer) && hasMigrate)) return;

    run("bash", ["-c", "lsof -ti:8080 | xargs -r kill -9"], fullApp); // in case a prior run left one behind
    run("make", ["db-drop"], fullApp);
    run("make", ["db-create"], fullApp);

    // fullApp already has Redis wired into readyz once "add worker" has run
    // earlier in this suite (same shared scratch project) — .env.example's
    // own REDIS_URL default (port 6379) won't reach the throwaway container's
    // actual ephemeral port. A shell-level `REDIS_URL=... make run` prefix
    // doesn't survive this: the Makefile's own `export $(... .env ...)` step
    // re-exports .env's REDIS_URL line and clobbers it. Bake the real URL
    // into .env itself instead.
    let envContent = readFileSync(path.join(fullApp, ".env.example"), "utf8").replace("AUTO_MIGRATE=true", "AUTO_MIGRATE=false");
    if (sharedRedisUrl) envContent = envContent.replace(/REDIS_URL=.*/, `REDIS_URL=${sharedRedisUrl}`);
    writeFileSync(path.join(fullApp, ".env"), envContent);

    // `kill -9 $PID` isn't enough to stop the server: `make run`'s PID is `make`
    // itself, and the actual listening binary is a grandchild via `go run` —
    // killing just the parent orphans it, still bound to the port and still
    // holding a Postgres connection, which then makes the final `db-drop` fail
    // with "database is being accessed by other users". Kill by port instead.
    const before = run(
      "bash",
      [
        "-c",
        "make run >/tmp/go-scaffold-smoke-boot.log 2>&1 & sleep 3; " +
          "CODE=$(curl -s -o /dev/null -w '%{http_code}' http://localhost:8080/readyz 2>/dev/null); CODE=${CODE:-000}; " +
          "LISTENING=$(lsof -ti:8080 | wc -l | tr -d ' '); " +
          "lsof -ti:8080 | xargs -r kill -9; " +
          "echo \"READYZ=$CODE LISTENING=$LISTENING\"",
      ],
      fullApp
    );
    if (!/READYZ=000 LISTENING=0/.test(before)) {
      throw new Error(`expected the server to refuse to boot (READYZ=000 LISTENING=0), got: ${before}`);
    }
    const beforeLog = readFileSync("/tmp/go-scaffold-smoke-boot.log", "utf8");
    if (!beforeLog.includes("migration version check")) {
      throw new Error(`expected a "migration version check" error in the boot log, got:\n${beforeLog}`);
    }

    run("migrate", ["-path", "migrations", "-database", "postgres://postgres:postgres@localhost:5432/full_app?sslmode=disable", "up"], fullApp);

    const after = run(
      "bash",
      [
        "-c",
        // REDIS_URL is already baked into .env above (needed once "add worker"
        // has run earlier in this suite) — `make run` loads it from there.
        "make run >/tmp/go-scaffold-smoke-boot.log 2>&1 & sleep 3; " +
          "CODE=$(curl -s -o /dev/null -w '%{http_code}' http://localhost:8080/readyz 2>/dev/null); CODE=${CODE:-000}; " +
          "lsof -ti:8080 | xargs -r kill -9; " +
          "echo \"READYZ=$CODE\"",
      ],
      fullApp
    );
    if (!/READYZ=200/.test(after)) {
      throw new Error(`expected the server to boot once migrated (READYZ=200), got: ${after}`);
    }

    // give Postgres a moment to notice the killed connection before db-drop
    execFileSync("sleep", ["1"]);
    run("make", ["db-drop"], fullApp);
  }
);

for (const [name, args] of Object.entries({
  "patch (resource action)": ["approve", "--type", "patch"],
  "get --get-mode all": ["findActive", "--type", "get", "--get-mode", "all"],
  "get --get-mode one --field": ["findByStatus", "--type", "get", "--get-mode", "one", "--field", "status"],
  post: ["archive", "--type", "post"],
  delete: ["removeAttachment", "--type", "delete"],
})) {
  step(`generate method order: ${name}`, () => {
    goScaffold(["generate", "method", "order", ...args], fullApp);
  });
}

step("after 5 generate method calls: build + vet + gofmt + test", () => {
  run("go", ["build", "./..."], fullApp);
  run("go", ["vet", "./..."], fullApp);
  const dirty = run("gofmt", ["-l", "."], fullApp).trim();
  if (dirty) throw new Error(`gofmt found unformatted files:\n${dirty}`);
  run("go", ["test", "./..."], fullApp);
});

step(
  hasGolangciLint
    ? "after 5 generate method calls: still lint-clean"
    : "after 5 generate method calls: lint check skipped (golangci-lint not installed)",
  () => {
    if (!hasGolangciLint) return;
    const out = run("golangci-lint", ["run"], fullApp);
    if (out.trim() && !out.includes("0 issues")) throw new Error(`expected 0 issues, got:\n${out}`);
  }
);

step("generate method rejects a duplicate method name", () => {
  expectThrows(() => goScaffold(["generate", "method", "order", "approve", "--type", "patch"], fullApp), "already exists");
});

step("generate method rejects --field id", () => {
  expectThrows(
    () => goScaffold(["generate", "method", "order", "findById", "--type", "get", "--get-mode", "one", "--field", "id"], fullApp),
    'cannot be "id"'
  );
});

step("generate module rejects a name that already exists", () => {
  expectThrows(() => goScaffold(["generate", "module", "order"], fullApp), "already exists");
});

step("rejects reserved Go words before writing broken code (module/method/field)", () => {
  expectThrows(() => goScaffold(["generate", "module", "type"], fullApp), "reserved Go word");
  expectThrows(() => goScaffold(["generate", "module", "string"], fullApp), "reserved Go word");
  expectThrows(() => goScaffold(["generate", "method", "order", "func", "--type", "post"], fullApp), "Go keyword");
  expectThrows(
    () => goScaffold(["generate", "method", "order", "findByType", "--type", "get", "--get-mode", "one", "--field", "type"], fullApp),
    "Go keyword"
  );
  expectThrows(() => goScaffold(["generate", "module", "2fa"], fullApp), "starts with a digit");
});

step("remove module reverses wiring and re-generating stays clean", () => {
  goScaffold(["generate", "module", "widget"], fullApp);
  run("go", ["build", "./..."], fullApp);
  goScaffold(["remove", "module", "widget", "--yes"], fullApp);
  if (existsSync(path.join(fullApp, "internal", "app", "widget"))) throw new Error("widget folder not deleted");
  const mainGo = readFileSync(path.join(fullApp, "cmd", "api", "main.go"), "utf8");
  if (mainGo.includes("widget.NewHandler")) throw new Error("main.go still wires widget after remove");
  const openapi = readFileSync(path.join(fullApp, "docs", "openapi.yaml"), "utf8");
  if (openapi.includes("/v1/widgets:")) throw new Error("openapi still lists widgets after remove");
  run("go", ["build", "./..."], fullApp); // must still compile with widget gone
  goScaffold(["generate", "module", "widget"], fullApp); // re-adding must not duplicate
  const registers = (readFileSync(path.join(fullApp, "cmd", "api", "main.go"), "utf8").match(/widget\.NewHandler\(/g) ?? []).length;
  if (registers !== 1) throw new Error(`expected 1 widget registration after re-add, got ${registers}`);
  run("go", ["build", "./..."], fullApp);
});

step("create --api-prefix beta scaffolds routes under a custom prefix", () => {
  goScaffold(["create", "beta-app", "--defaults", "--api-prefix", "beta"], scratch);
});

const betaApp = path.join(scratch, "beta-app");
step("custom prefix: generate module + method, routes land under /beta", () => {
  run("go", ["mod", "tidy"], betaApp);
  goScaffold(["generate", "module", "product"], betaApp);
  goScaffold(["generate", "method", "product", "findByStatus", "--type", "get", "--get-mode", "one", "--field", "status"], betaApp);
  const mainGo = readFileSync(path.join(betaApp, "cmd", "api", "main.go"), "utf8");
  if (!mainGo.includes('api := r.Group("/beta")')) throw new Error('expected api := r.Group("/beta") in main.go');
  const openapi = readFileSync(path.join(betaApp, "docs", "openapi.yaml"), "utf8");
  if (!openapi.includes("/beta/products:")) throw new Error("expected /beta/products in openapi.yaml");
  run("go", ["build", "./..."], betaApp);
  run("go", ["vet", "./..."], betaApp);
});

step("create --api-prefix '' scaffolds routes with no prefix at all", () => {
  goScaffold(["create", "noprefix-app", "--defaults", "--api-prefix", ""], scratch);
  const app = path.join(scratch, "noprefix-app");
  run("go", ["mod", "tidy"], app);
  goScaffold(["generate", "module", "widget"], app);
  const mainGo = readFileSync(path.join(app, "cmd", "api", "main.go"), "utf8");
  if (!mainGo.includes('api := r.Group("/")')) throw new Error('expected api := r.Group("/") in main.go');
  const openapi = readFileSync(path.join(app, "docs", "openapi.yaml"), "utf8");
  if (!openapi.includes("/widgets:")) throw new Error("expected /widgets (no prefix) in openapi.yaml");
  if (openapi.includes("/v1/widgets:")) throw new Error("should not have a /v1 prefix");
  run("go", ["build", "./..."], app);
  run("go", ["vet", "./..."], app);
});

step("create --api-prefix api/v1 supports multi-segment prefixes (gin joins them fine)", () => {
  goScaffold(["create", "multiseg-app", "--defaults", "--api-prefix", "/api/v1/"], scratch);
  const app = path.join(scratch, "multiseg-app");
  const cfg = JSON.parse(readFileSync(path.join(app, "go-scaffold.config.json"), "utf8"));
  if (cfg.apiPrefix !== "api/v1") throw new Error(`expected leading/trailing slashes stripped, got "${cfg.apiPrefix}"`);
  run("go", ["mod", "tidy"], app);
  goScaffold(["generate", "module", "order"], app);
  const mainGo = readFileSync(path.join(app, "cmd", "api", "main.go"), "utf8");
  if (!mainGo.includes('api := r.Group("/api/v1")')) throw new Error('expected api := r.Group("/api/v1") in main.go');
  const openapi = readFileSync(path.join(app, "docs", "openapi.yaml"), "utf8");
  if (!openapi.includes("/api/v1/orders:")) throw new Error("expected /api/v1/orders in openapi.yaml");
  run("go", ["build", "./..."], app);
  run("go", ["vet", "./..."], app);
});

step("create --no-full minimal module layers up to full build", () => {
  goScaffold(["create", "min-app", "--defaults"], scratch);
  const minApp = path.join(scratch, "min-app");
  run("go", ["mod", "tidy"], minApp);
  goScaffold(["generate", "module", "widget", "--no-full"], minApp);
  run("go", ["build", "./..."], minApp);
  if (hasGolangciLint) {
    // bare minimal module, zero methods yet: the ahead-of-use plumbing
    // (fakeRepo, test harness, wrapFindErr, response/toResponse) must not
    // trip `unused` before anything has wired it in.
    const out = run("golangci-lint", ["run"], minApp);
    if (out.trim() && !out.includes("0 issues")) throw new Error(`bare minimal module: expected 0 issues, got:\n${out}`);
  }
  goScaffold(["generate", "method", "widget", "create", "--type", "post"], minApp);
  goScaffold(["generate", "method", "widget", "list", "--type", "get", "--get-mode", "all"], minApp);
  goScaffold(["generate", "method", "widget", "findByStatus", "--type", "get", "--get-mode", "one", "--field", "status"], minApp);
  run("go", ["build", "./..."], minApp);
  run("go", ["vet", "./..."], minApp);
  const dirty = run("gofmt", ["-l", "."], minApp).trim();
  if (dirty) throw new Error(`gofmt found unformatted files:\n${dirty}`);
  if (hasGolangciLint) {
    const out = run("golangci-lint", ["run"], minApp);
    if (out.trim() && !out.includes("0 issues")) throw new Error(`layered minimal module: expected 0 issues, got:\n${out}`);
  }
});

// The two halves of drift detection. `create` emits the shared/ layer once;
// `generate` renders templates written against that exact layer. A project that
// later edits shared/ — normal, expected work — silently falls out of sync, and
// the break lands in generated files the user never wrote. These two steps pin
// down both "catches it" and "doesn't cry wolf".
step("generate fails loudly when the project's shared/ layer has drifted", () => {
  goScaffold(["create", "drift-app", "--defaults"], scratch);
  const app = path.join(scratch, "drift-app");
  run("go", ["mod", "tidy"], app);

  // Simulates a project whose shared/ layer moved on after scaffolding —
  // middleware.Error grows a parameter and its one caller is updated, but the
  // CLI's own frozen template (what `generate module` renders) doesn't know
  // that happened. Prepends a new first parameter via a plain anchored string
  // replace rather than trying to capture-and-reinsert whatever's already
  // inside the parens: existing call sites can contain their own nested
  // parens (e.g. `middleware.Error(!cfg.IsProd())`), which a `[^)]*` regex
  // can't balance — it matches up to the *inner* `)` and mangles the
  // rewrite. A left-anchored prepend never needs to look past `Error(`, so it
  // stays correct regardless of what's already inside.
  const errPath = path.join(app, "internal", "shared", "middleware", "error.go");
  const errSrc = readFileSync(errPath, "utf8");
  const mutatedErr = errSrc.replace("func Error(", "func Error(_extraDrift bool, ");
  if (mutatedErr === errSrc) throw new Error("middleware.Error signature not found — update this test's mutation");
  writeFileSync(errPath, mutatedErr);

  const mainPath = path.join(app, "cmd", "api", "main.go");
  const mainSrc = readFileSync(mainPath, "utf8");
  const mutatedMain = mainSrc.replace("middleware.Error(", "middleware.Error(true, ");
  if (mutatedMain === mainSrc) throw new Error("middleware.Error call site not found — update this test's mutation");
  writeFileSync(mainPath, mutatedMain);

  run("go", ["vet", "./..."], app); // the project itself is still perfectly fine

  // the generated handler_test.go builds the middleware chain by hand using
  // generate module's frozen template, which doesn't know about the mutation
  // above — `go build` wouldn't see it (test file), `go vet` does.
  expectThrows(() => goScaffold(["generate", "module", "order"], app), "drift");
});

step("generate doesn't blame itself for a project that was already broken", () => {
  goScaffold(["create", "prebroken-app", "--defaults"], scratch);
  const app = path.join(scratch, "prebroken-app");
  run("go", ["mod", "tidy"], app);
  // a type error the user introduced, nothing to do with the generator
  writeFileSync(path.join(app, "internal", "shared", "id", "wip.go"), 'package id\n\nfunc wip() int { return "nope" }\n');
  goScaffold(["generate", "module", "order"], app); // must still succeed
  if (!existsSync(path.join(app, "internal", "app", "order", "handler.go"))) {
    throw new Error("module wasn't generated");
  }
});

cleanup();
console.log(`\n${passed} checks passed.`);
