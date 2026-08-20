// `docker build .` with no --target builds whatever stage comes last. That
// used to be `worker`, whose COPY --from=build /out/worker cannot resolve
// until `add worker` has created cmd/worker — so the plainest possible build
// command failed on every freshly created project with "/out/worker: not
// found". Order is load-bearing here, and nothing else in the suite would
// notice it changing.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(path.dirname(path.dirname(fileURLToPath(import.meta.url))));
const CLI = path.join(ROOT, "bin", "go-scaffold.js");

test("the Dockerfile's last stage is api, so a bare `docker build .` works before `add worker`", (t) => {
  const dir = mkdtempSync(path.join(tmpdir(), "go-scaffold-dockerfile-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  execFileSync("node", [CLI, "create", "app", "--defaults"], { cwd: dir, stdio: "ignore" });

  const dockerfile = readFileSync(path.join(dir, "app", "Dockerfile"), "utf8");
  const stages = [...dockerfile.matchAll(/^FROM .+ AS (\w+)$/gm)].map((m) => m[1]);

  assert.deepEqual(stages, ["build", "worker", "api"], "stage order changed");
  assert.equal(stages.at(-1), "api", "the default `docker build .` target must be a binary every project has");

  // and the worker build itself stays conditional, or the build stage would
  // fail before any target got a chance to resolve
  assert.match(dockerfile, /if \[ -d \.\/cmd\/worker \]; then go build/);
});
