import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(path.dirname(path.dirname(fileURLToPath(import.meta.url))));
const CLI = path.join(ROOT, "bin", "go-scaffold.js");

function startServer(cwd, args = []) {
  const child = spawn(process.execPath, [CLI, "mcp", ...args], {
    cwd,
    stdio: ["pipe", "pipe", "pipe"],
  });
  let buffer = "";
  let nextId = 1;
  const pending = new Map();
  const errors = [];
  child.stdout.on("data", (chunk) => {
    buffer += chunk.toString();
    let index;
    while ((index = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, index).trim();
      buffer = buffer.slice(index + 1);
      if (!line) continue;
      const message = JSON.parse(line);
      if (message.id !== undefined && pending.has(message.id)) {
        const { resolve, reject } = pending.get(message.id);
        pending.delete(message.id);
        if (message.error) reject(new Error(`${message.error.code}: ${message.error.message}`));
        else resolve(message.result);
      }
    }
  });
  child.stderr.on("data", (chunk) => errors.push(chunk.toString()));
  const request = (method, params = {}) => new Promise((resolve, reject) => {
    const id = nextId++;
    pending.set(id, { resolve, reject });
    child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
  });
  const stop = () => new Promise((resolve) => {
    child.once("close", resolve);
    child.kill();
  });
  return { child, request, stop, errors };
}

function textOf(result) {
  return JSON.parse(result.content[0].text);
}

test("MCP server exposes the scaffolding tools and keeps plan read-only", { timeout: 120000 }, async () => {
  const scratch = mkdtempSync(path.join(tmpdir(), "go-scaffold-mcp-"));
  const server = startServer(scratch);
  try {
    const init = await server.request("initialize", { protocolVersion: "2024-11-05" });
    assert.equal(init.serverInfo.name, "go-scaffold-mcp");

    const listed = await server.request("tools/list");
    assert.deepEqual(listed.tools.map((tool) => tool.name).sort(), [
      "scaffold_check",
      "scaffold_config_show",
      "scaffold_contract_export",
      "scaffold_create_apply",
      "scaffold_create_plan",
      "scaffold_fullstack_apply",
      "scaffold_fullstack_plan",
      "scaffold_interview",
      "scaffold_preset_list",
    ]);

    const interview = textOf(await server.request("tools/call", {
      name: "scaffold_interview",
      arguments: {},
    }));
    assert.equal(interview.schemaVersion, 1);
    assert.ok(interview.questions.some((question) => question.id === "http.preset"));

    const answers = {
      "project.name": "mcp-shop",
      "project.goModule": "github.com/acme/mcp-shop",
      "features.docker": false,
      "features.openapiDocs": true,
      "features.observability": false,
      "apiPrefix": "v1",
      "http.preset": "envelope",
      "architecture.moduleProfile": "crud",
    };
    const plan = textOf(await server.request("tools/call", {
      name: "scaffold_create_plan",
      arguments: { answers },
    }));
    assert.equal(plan.writes, false);
    assert.equal(plan.http.preset, "envelope");
    assert.ok(!existsSync(path.join(scratch, "mcp-shop")), "plan must not create the project");

    const applied = textOf(await server.request("tools/call", {
      name: "scaffold_create_apply",
      arguments: { answers },
    }));
    assert.equal(applied.ok, true);
    const config = JSON.parse(readFileSync(path.join(scratch, "mcp-shop", "go-scaffold.config.json"), "utf8"));
    assert.equal(config.http.preset, "envelope");

    const presets = textOf(await server.request("tools/call", {
      name: "scaffold_preset_list",
      arguments: {},
    }));
    assert.ok(presets.presets.some((preset) => preset.name === "envelope"));

    await assert.rejects(
      server.request("does/not/exist"),
      /-32601/,
    );

    const checkServer = startServer(path.join(scratch, "mcp-shop"));
    try {
      const contract = textOf(await checkServer.request("tools/call", {
        name: "scaffold_contract_export",
        arguments: {},
      }));
      assert.equal(contract.preset, "envelope");
      assert.equal(contract.resolved.list, "data-meta");

      const checked = textOf(await checkServer.request("tools/call", {
        name: "scaffold_check",
        arguments: {},
      }));
      assert.equal(checked.ok, true);
      assert.match(checked.output, /http contract: envelope/);
    } finally {
      await checkServer.stop();
    }
  } finally {
    await server.stop();
    rmSync(scratch, { recursive: true, force: true });
  }
});

test("MCP server refuses a root outside its launch directory", async () => {
  const scratch = mkdtempSync(path.join(tmpdir(), "go-scaffold-mcp-root-"));
  try {
    const server = startServer(scratch, ["--root", ".."]);
    await new Promise((resolve) => server.child.once("close", resolve));
    assert.match(server.errors.join(""), /OUTSIDE_ROOT/);
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
});
