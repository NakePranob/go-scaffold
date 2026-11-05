import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(path.dirname(path.dirname(fileURLToPath(import.meta.url))));
const CLI = path.join(ROOT, "bin", "go-scaffold.js");

function run(cwd, ...args) {
  return execFileSync("node", [CLI, ...args], {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

/** A stand-in for an installed FSD CLI: it records the contract path it was
 *  handed and answers in the JSON shape the gateway parses. */
function installFakeFsd(clientDir) {
  const bin = path.join(clientDir, "node_modules", "@nakedev", "nextjs-fsd", "bin", "nextjs-fsd.js");
  mkdirSync(path.dirname(bin), { recursive: true });
  writeFileSync(
    bin,
    `#!/usr/bin/env node
const fs = require("fs");
const args = process.argv.slice(2);
const index = args.indexOf("--answers");
const answers = JSON.parse(fs.readFileSync(args[index + 1], "utf8"));
console.log(JSON.stringify(args[0] === "plan"
  ? { schemaVersion: 1, writes: false, steps: [], warnings: [], contract: answers.httpContract }
  : { schemaVersion: 1, ok: true, steps: [], warnings: [], contract: answers.httpContract }, null, 2));
`
  );
}

function writeAnswers(dir, answers) {
  const file = path.join(dir, "answers.json");
  writeFileSync(file, JSON.stringify(answers, null, 2));
  return file;
}

test("fullstack plan validates both sides and writes nothing", () => {
  const scratch = mkdtempSync(path.join(tmpdir(), "go-scaffold-fullstack-"));
  try {
    const client = path.join(scratch, "web");
    mkdirSync(client);
    installFakeFsd(client);

    const answers = writeAnswers(scratch, {
      api: {
        answers: {
          "project.name": "demo-api",
          "features.docker": false,
          "features.openapiDocs": false,
          "features.observability": false,
          "http.preset": "envelope",
        },
      },
      client: { target: "nextjs", path: "web", answers: { init: false } },
    });

    const plan = JSON.parse(run(scratch, "fullstack", "plan", "--answers", answers));
    assert.equal(plan.writes, false);
    assert.equal(plan.api.mode, "create");
    assert.equal(plan.api.plan.http.preset, "envelope");
    assert.equal(plan.contract.preset, "envelope");
    assert.deepEqual(plan.contract.resolved, { single: "data", list: "data-meta", error: "error-object" });
    assert.deepEqual(plan.steps.map((step) => step.id), ["api-create-plan", "client-plan"]);
    assert.equal(existsSync(path.join(scratch, "demo-api")), false, "plan must not create the API");
    assert.equal(existsSync(path.join(client, "http-contract.json")), false, "plan must not write the client contract");
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
});

test("fullstack apply creates the API and hands the same artifact to the client", () => {
  const scratch = mkdtempSync(path.join(tmpdir(), "go-scaffold-fullstack-"));
  try {
    const client = path.join(scratch, "web");
    mkdirSync(client);
    installFakeFsd(client);

    const answers = writeAnswers(scratch, {
      api: {
        answers: {
          "project.name": "demo-api",
          "features.docker": false,
          "features.openapiDocs": false,
          "features.observability": false,
          "http.preset": "envelope",
        },
      },
      client: { target: "nextjs", path: "web", answers: { init: false } },
    });

    const applied = JSON.parse(run(scratch, "fullstack", "apply", "--answers", answers));
    assert.equal(applied.ok, true);
    assert.equal(applied.api.mode, "create");

    const apiArtifact = JSON.parse(readFileSync(path.join(scratch, "demo-api", "http-contract.json"), "utf8"));
    const clientArtifact = JSON.parse(readFileSync(path.join(client, "http-contract.json"), "utf8"));
    assert.deepEqual(clientArtifact, apiArtifact, "the client must receive the API's artifact byte-for-byte");
    assert.equal(applied.contract.presetHash, apiArtifact.presetHash);
    assert.equal(applied.client.output.contract, path.join(client, "http-contract.json"));
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
});

test("fullstack reuses an existing API and exports its frozen contract", () => {
  const scratch = mkdtempSync(path.join(tmpdir(), "go-scaffold-fullstack-"));
  try {
    const client = path.join(scratch, "web");
    mkdirSync(client);
    installFakeFsd(client);
    run(
      scratch,
      "create",
      "existing-api",
      "--defaults",
      "--no-docker",
      "--no-openapi-docs",
      "--http-preset",
      "items"
    );

    const answers = writeAnswers(scratch, {
      api: { existing: true, path: "existing-api" },
      client: { target: "nextjs", path: "web", answers: { init: false } },
    });

    const plan = JSON.parse(run(scratch, "fullstack", "plan", "--answers", answers));
    assert.equal(plan.api.mode, "existing");
    assert.equal(plan.contract.preset, "items");
    assert.deepEqual(plan.steps.map((step) => step.id), ["api-existing", "client-plan"]);

    const applied = JSON.parse(run(scratch, "fullstack", "apply", "--answers", answers));
    assert.equal(applied.ok, true);
    assert.equal(applied.api.mode, "existing");
    const artifact = JSON.parse(readFileSync(path.join(client, "http-contract.json"), "utf8"));
    assert.equal(artifact.preset, "items");
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
});

test("fullstack fails before writing when the client CLI is missing", () => {
  const scratch = mkdtempSync(path.join(tmpdir(), "go-scaffold-fullstack-"));
  try {
    const client = path.join(scratch, "web");
    mkdirSync(client);
    const answers = writeAnswers(scratch, {
      api: { answers: { "project.name": "demo-api" } },
      client: { target: "sveltekit", path: "web", answers: { init: false } },
    });

    assert.throws(
      () => run(scratch, "fullstack", "plan", "--answers", answers),
      /cannot find sveltekit-fsd/,
      "the error must name the missing FSD CLI instead of failing later"
    );
    assert.equal(existsSync(path.join(scratch, "demo-api")), false);
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
});

test("fullstack refuses a client path outside its launch directory", () => {
  const scratch = mkdtempSync(path.join(tmpdir(), "go-scaffold-fullstack-"));
  try {
    const answers = writeAnswers(scratch, {
      api: { answers: { "project.name": "demo-api" } },
      client: { target: "nextjs", path: "../outside", answers: { init: false } },
    });
    assert.throws(() => run(scratch, "fullstack", "plan", "--answers", answers), /must stay inside/);
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
});

test("fullstack passes a company preset directory to both sides", () => {
  const scratch = mkdtempSync(path.join(tmpdir(), "go-scaffold-fullstack-"));
  try {
    const client = path.join(scratch, "web");
    mkdirSync(client);
    installFakeFsd(client);
    mkdirSync(path.join(scratch, "presets"));
    writeFileSync(
      path.join(scratch, "presets", "acme.json"),
      JSON.stringify({
        schemaVersion: 1,
        name: "acme",
        http: { single: "data", list: "data-meta", error: "problem-json" },
      })
    );

    const answers = writeAnswers(scratch, {
      api: {
        presetDir: "presets",
        answers: {
          "project.name": "acme-api",
          "features.docker": false,
          "features.openapiDocs": false,
          "features.observability": false,
          "http.preset": "acme",
        },
      },
      client: { target: "nextjs", path: "web", answers: { init: false } },
    });

    const plan = JSON.parse(run(scratch, "fullstack", "plan", "--answers", answers));
    assert.equal(plan.contract.preset, "acme");

    const applied = JSON.parse(run(scratch, "fullstack", "apply", "--answers", answers));
    assert.equal(applied.ok, true);
    const apiArtifact = JSON.parse(readFileSync(path.join(scratch, "acme-api", "http-contract.json"), "utf8"));
    assert.equal(apiArtifact.preset, "acme");
    assert.deepEqual(JSON.parse(readFileSync(path.join(client, "http-contract.json"), "utf8")), apiArtifact);
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
});
