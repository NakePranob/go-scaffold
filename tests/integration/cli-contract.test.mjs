import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import test from "node:test";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(path.dirname(path.dirname(fileURLToPath(import.meta.url))));
const CLI = path.join(ROOT, "bin", "go-scaffold.js");

function help(...args) {
  return execFileSync("node", [CLI, ...args, "--help"], { encoding: "utf8" });
}

test("every public command exposes a useful description", () => {
  const cases = [
    { args: [], expected: "Scaffold Gin + GORM + Postgres Go backend projects" },
    { args: ["create"], expected: "scaffold a new project" },
    { args: ["generate"], expected: "add a module, endpoint, or migration" },
    { args: ["generate", "module"], expected: "Lean, CRUD, CQRS, or Advanced" },
    { args: ["generate", "method"], expected: "add one endpoint" },
    { args: ["generate", "migration"], expected: "reserve a timestamped up/down SQL pair" },
    { args: ["config"], expected: "configure future module defaults" },
    { args: ["config", "show"], expected: "print the resolved project config" },
    { args: ["config", "validate"], expected: "validate project config" },
    { args: ["add"], expected: "add opt-in infrastructure" },
    { args: ["add", "worker"], expected: "add a background job queue" },
    { args: ["add", "auth"], expected: "add email/password auth" },
    { args: ["add", "rbac"], expected: "add role-based access control" },
    { args: ["add", "observability"], expected: "add Prometheus" },
    { args: ["undo"], expected: "undo a generated module" },
    { args: ["undo", "module"], expected: "delete a generated module" },
  ];

  for (const entry of cases) assert.match(help(...entry.args), new RegExp(entry.expected.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
});

test("module and method options explain their interactive and scripted paths", () => {
  const moduleHelp = help("generate", "module");
  assert.match(moduleHelp, /--profile <profile>/);
  assert.match(moduleHelp, /choose the architecture preset: lean \(minimal \+\s+service\),\s+crud \(CRUD \+\s+service\),\s+or cqrs \(minimal \+\s+CQRS\)/);
  assert.match(moduleHelp, /skip every wizard question/);

  const methodHelp = help("generate", "method");
  assert.match(methodHelp, /omitted module, name, and endpoint\s+details are asked by the wizard/);
  assert.match(methodHelp, /GET only: all for a list endpoint or one for a lookup by\s+another field/);
});
