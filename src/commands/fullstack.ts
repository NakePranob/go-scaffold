import { spawn } from "child_process";
import path from "path";
import os from "os";
import fs from "fs-extra";

import { isProjectDir } from "../utils/config";
import { contractArtifact, writeContractArtifact } from "./contract";
import { httpConfigFromPreset, presetDirs, resolvePreset } from "../utils/http-contract";
import { HttpContractArtifact } from "./contract";
import { ResolvedHttpContract } from "../types";

/**
 * The full-stack gateway: one answers file decides the Go API and the FSD
 * client, and the HTTP contract travels between them.
 *
 * This is a router, not a generator. It spawns `go-scaffold create` and then the
 * FSD CLI's own `plan`/`apply`; neither side gains a second implementation of
 * its rules, and each step keeps the JSON interface agents already use.
 */

export type ClientTarget = "nextjs" | "sveltekit";

export interface FullstackApiAnswers {
  /** Answers object for `go-scaffold create --answers`. */
  answers?: Record<string, unknown>;
  /** Reuse an existing go-scaffold project instead of creating one. */
  existing?: boolean;
  /** Existing project directory; relative to the gateway's working directory. */
  path?: string;
  /** Directory holding company preset JSON files. */
  presetDir?: string;
}

export interface FullstackClientAnswers {
  target: ClientTarget;
  path: string;
  /** FSD CLI entry point; overrides detection from the client's node_modules. */
  cli?: string;
  /** Answers object for the FSD `plan`/`apply` commands, without httpContract. */
  answers: Record<string, unknown>;
}

export interface FullstackAnswers {
  api: FullstackApiAnswers;
  client: FullstackClientAnswers;
}

export interface GatewayStep {
  id: string;
  description: string;
  command: string[];
}

export interface FullstackPlan {
  schemaVersion: 1;
  writes: false;
  root: string;
  api: {
    mode: "create" | "existing";
    directory: string;
    plan?: unknown;
  };
  client: { target: ClientTarget; directory: string; plan: unknown };
  contract: { file: string; preset: string; resolved: ResolvedHttpContract; presetHash: string };
  steps: GatewayStep[];
  warnings: string[];
}

export interface FullstackApply {
  schemaVersion: 1;
  ok: boolean;
  root: string;
  api: { mode: "create" | "existing"; directory: string; output?: string };
  client: { target: ClientTarget; directory: string; output?: unknown; error?: string };
  contract: { file: string; preset: string; presetHash: string };
  warnings: string[];
}

const TARGETS: readonly ClientTarget[] = ["nextjs", "sveltekit"];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requiredString(value: unknown, label: string): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${label} must be a non-empty string`);
  return value.trim();
}

/** The gateway writes a contract into the client and may create the API, so
 *  both paths must stay inside the directory it was launched from — the same
 *  boundary the MCP server promises. Run it from the workspace root. */
function assertInside(root: string, target: string, label: string): void {
  const relative = path.relative(root, target);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`${label} must stay inside ${root} (got ${target})`);
  }
}

function readAnswers(file: string): FullstackAnswers {
  const text = file === "-" ? fs.readFileSync(0, "utf8") : fs.readFileSync(path.resolve(file), "utf8");
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (error) {
    throw new Error(`${file}: answers are not valid JSON (${(error as Error).message})`);
  }
  if (!isRecord(raw)) throw new Error(`${file}: answers must be a JSON object`);
  if (!isRecord(raw.api)) throw new Error(`${file}: api must be an object`);
  if (!isRecord(raw.client)) throw new Error(`${file}: client must be an object`);

  const target = requiredString(raw.client.target, "client.target") as ClientTarget;
  if (!TARGETS.includes(target)) throw new Error(`client.target must be one of: ${TARGETS.join(", ")}`);
  const clientPath = requiredString(raw.client.path, "client.path");
  if (!isRecord(raw.client.answers)) throw new Error("client.answers must be an object");
  const cli = raw.client.cli === undefined ? undefined : requiredString(raw.client.cli, "client.cli");

  const api: FullstackApiAnswers = {};
  if (raw.api.existing !== undefined) {
    if (typeof raw.api.existing !== "boolean") throw new Error("api.existing must be true or false");
    api.existing = raw.api.existing;
  }
  if (raw.api.path !== undefined) api.path = requiredString(raw.api.path, "api.path");
  if (raw.api.presetDir !== undefined) api.presetDir = requiredString(raw.api.presetDir, "api.presetDir");
  if (raw.api.answers !== undefined) {
    if (!isRecord(raw.api.answers)) throw new Error("api.answers must be an object");
    api.answers = raw.api.answers;
  }
  if (!api.existing && !api.answers) throw new Error("api.answers is required unless api.existing is true");
  if (api.existing && !api.path) throw new Error("api.path is required when api.existing is true");

  return {
    api,
    client: { target, path: clientPath, answers: raw.client.answers, ...(cli ? { cli } : {}) },
  };
}

function apiDirectory(answers: FullstackAnswers, root: string): string {
  if (answers.api.existing) return path.resolve(root, answers.api.path!);
  const project = answers.api.answers!["project.name"];
  if (typeof project !== "string" || !project.trim()) {
    throw new Error("api.answers['project.name'] is required to create the API");
  }
  return path.resolve(root, project.trim().includes("/") ? project.trim().split("/").pop()! : project.trim());
}

function contractForNewApi(answers: FullstackAnswers, presetDir: string | undefined): HttpContractArtifact {
  const raw = answers.api.answers!;
  const preset = raw["http.preset"] ?? raw.httpPreset ?? "default";
  if (typeof preset !== "string") throw new Error("api.answers['http.preset'] must be a string");
  const config = httpConfigFromPreset(resolvePreset(preset, presetDirs(presetDir)).preset);
  const projectName = String(raw["project.name"]);
  const goModule = typeof raw["project.goModule"] === "string" ? raw["project.goModule"] : projectName;
  return {
    schemaVersion: 1,
    projectName,
    goModule,
    apiPrefix: typeof raw.apiPrefix === "string" ? raw.apiPrefix : "",
    preset: config.preset,
    resolved: config.resolved,
    presetHash: config.presetHash,
  };
}

function contractForExistingApi(directory: string): HttpContractArtifact {
  if (!isProjectDir(directory)) {
    throw new Error(`${directory} is not a go-scaffold project (go-scaffold.config.json not found)`);
  }
  return contractArtifact(directory);
}

function fsdCliPath(answers: FullstackAnswers, root: string): string {
  const clientDir = path.resolve(root, answers.client.path);
  const bin = answers.client.target === "nextjs" ? "nextjs-fsd" : "sveltekit-fsd";
  const candidates = [
    answers.client.cli ? path.resolve(root, answers.client.cli) : undefined,
    path.join(clientDir, "node_modules", "@nakedev", bin, "bin", `${bin}.js`),
    path.join(clientDir, "node_modules", "@nakedev", bin, "bin", `${bin}.cjs`),
  ].filter((candidate): candidate is string => Boolean(candidate));
  const found = candidates.find((candidate) => fs.existsSync(candidate));
  if (!found) {
    throw new Error(
      `cannot find ${bin} in ${clientDir} — install @nakedev/${bin} there, or set client.cli to its bin/${bin}.js`
    );
  }
  return found;
}

function cliPath(): string {
  return path.resolve(__dirname, "..", "..", "bin", "go-scaffold.js");
}

function run(cwd: string, args: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, args, {
      cwd,
      env: { ...process.env, NO_COLOR: "1" },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("close", (code) => resolve({ code: code ?? 1, stdout, stderr }));
  });
}

function parseJson(text: string, label: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`${label} did not return JSON: ${text.trim()}`);
  }
}

interface Prepared {
  root: string;
  answers: FullstackAnswers;
  apiDir: string;
  clientDir: string;
  contract: HttpContractArtifact;
  contractFile: string;
  tempDir: string;
  apiAnswersFile: string;
  clientAnswersFile: string;
  apiPresetDir?: string;
}

function prepare(file: string, root: string): Prepared {
  const answers = readAnswers(file);
  const apiDir = apiDirectory(answers, root);
  const clientDir = path.resolve(root, answers.client.path);
  assertInside(root, apiDir, "api directory");
  assertInside(root, clientDir, "client.path");
  if (!fs.existsSync(clientDir) || !fs.statSync(clientDir).isDirectory()) {
    throw new Error(`client.path does not exist or is not a directory: ${clientDir}`);
  }

  let contract: HttpContractArtifact;
  const apiPresetDir = answers.api.presetDir ? path.resolve(root, answers.api.presetDir) : undefined;
  if (answers.api.existing) {
    contract = contractForExistingApi(apiDir);
  } else {
    if (fs.existsSync(apiDir) && fs.readdirSync(apiDir).length > 0) {
      throw new Error(`${apiDir} already exists and is not empty — set api.existing true to reuse it`);
    }
    contract = contractForNewApi(answers, apiPresetDir);
  }

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "go-scaffold-fullstack-"));
  const contractFile = path.join(tempDir, "http-contract.json");
  fs.writeJsonSync(contractFile, contract, { spaces: 2 });

  const apiAnswersFile = path.join(tempDir, "api-answers.json");
  if (answers.api.answers) fs.writeJsonSync(apiAnswersFile, answers.api.answers, { spaces: 2 });

  const clientAnswersFile = path.join(tempDir, "client-answers.json");
  fs.writeJsonSync(
    clientAnswersFile,
    { ...answers.client.answers, httpContract: contractFile },
    { spaces: 2 }
  );

  return {
    root,
    answers,
    apiDir,
    clientDir,
    contract,
    contractFile,
    tempDir,
    apiAnswersFile,
    clientAnswersFile,
    ...(apiPresetDir ? { apiPresetDir } : {}),
  };
}

export async function fullstackPlan(file: string, root: string): Promise<FullstackPlan> {
  const prepared = prepare(file, root);
  const { answers, apiDir, clientDir, contract, tempDir } = prepared;
  const warnings: string[] = [];
  const steps: GatewayStep[] = [];

  let apiPlan: unknown;
  if (answers.api.existing) {
    steps.push({ id: "api-existing", description: `reuse the API at ${apiDir}`, command: [] });
  } else {
    const command = [
      "create",
      "--answers",
      prepared.apiAnswersFile,
      "--plan",
      ...(prepared.apiPresetDir ? ["--preset-dir", prepared.apiPresetDir] : []),
    ];
    steps.push({ id: "api-create-plan", description: "validate the Go project plan", command });
    const result = await run(root, [cliPath(), ...command]);
    if (result.code !== 0) throw new Error(`go-scaffold create --plan failed: ${result.stderr || result.stdout}`);
    apiPlan = parseJson(result.stdout, "create --plan");
  }

  const fsd = fsdCliPath(answers, root);
  const clientCommand = ["plan", "--answers", prepared.clientAnswersFile];
  steps.push({ id: "client-plan", description: `validate the ${answers.client.target} FSD plan`, command: clientCommand });
  const clientResult = await run(clientDir, [fsd, ...clientCommand]);
  if (clientResult.code !== 0) {
    throw new Error(`${answers.client.target} plan failed: ${clientResult.stderr || clientResult.stdout}`);
  }
  const clientPlan = parseJson(clientResult.stdout, "fsd plan") as { warnings?: string[] };
  warnings.push(...(clientPlan.warnings ?? []));

  if (contract.preset !== "default") {
    warnings.push(
      `the API uses the "${contract.preset}" HTTP preset; the client parsers are generated from the same artifact`
    );
  }

  fs.removeSync(tempDir);
  return {
    schemaVersion: 1,
    writes: false,
    root,
    api: { mode: answers.api.existing ? "existing" : "create", directory: apiDir, ...(apiPlan ? { plan: apiPlan } : {}) },
    client: { target: answers.client.target, directory: clientDir, plan: clientPlan },
    contract: {
      file: path.join(clientDir, "http-contract.json"),
      preset: contract.preset,
      resolved: contract.resolved,
      presetHash: contract.presetHash,
    },
    steps,
    warnings,
  };
}

export async function fullstackApply(file: string, root: string): Promise<FullstackApply> {
  const prepared = prepare(file, root);
  const { answers, apiDir, clientDir, contract, tempDir } = prepared;
  const warnings: string[] = [];

  let apiOutput: string | undefined;
  if (answers.api.existing) {
    if (!isProjectDir(apiDir)) warnings.push(`${apiDir} is not a go-scaffold project`);
  } else {
    const result = await run(root, [
      cliPath(),
      "create",
      "--answers",
      prepared.apiAnswersFile,
      "--apply",
      ...(prepared.apiPresetDir ? ["--preset-dir", prepared.apiPresetDir] : []),
    ]);
    if (result.code !== 0) {
      fs.removeSync(tempDir);
      throw new Error(`go-scaffold create --apply failed: ${result.stderr || result.stdout}`);
    }
    apiOutput = result.stdout.trim();
    // `create` writes the artifact at the API root. Use that file rather than
    // the temp copy so the API project and the client cannot disagree — and
    // fail before touching the client if the preset resolved differently.
    const apiContract = path.join(apiDir, "http-contract.json");
    if (!fs.existsSync(apiContract)) writeContractArtifact(apiDir);
    const created = contractArtifact(apiDir);
    if (created.presetHash !== contract.presetHash) {
      throw new Error(
        `the created API contract ${created.presetHash} does not match the gateway contract ${contract.presetHash}; ` +
          "check --preset-dir and re-run with api.existing true after fixing the preset"
      );
    }
  }

  // The client keeps the artifact next to its config, so later installs and
  // contract checks read the same file this run generated from.
  const clientContract = path.join(clientDir, "http-contract.json");
  if (fs.existsSync(clientContract)) {
    try {
      const existing = fs.readJsonSync(clientContract) as Partial<HttpContractArtifact>;
      if (existing.presetHash && existing.presetHash !== contract.presetHash) {
        warnings.push(`overwriting ${clientContract} — its presetHash did not match the API contract`);
      }
    } catch {
      warnings.push(`overwriting ${clientContract} — it was not valid JSON`);
    }
  }
  fs.writeJsonSync(clientContract, contract, { spaces: 2 });
  fs.writeJsonSync(
    prepared.clientAnswersFile,
    { ...answers.client.answers, httpContract: clientContract },
    { spaces: 2 }
  );

  const fsd = fsdCliPath(answers, root);
  const result = await run(clientDir, [fsd, "apply", "--answers", prepared.clientAnswersFile]);
  const payload = parseJson(result.stdout || "{}", `${answers.client.target} apply`) as {
    ok?: boolean;
    warnings?: string[];
    steps?: Array<{ id: string; ok: boolean; stderr?: string }>;
  };
  warnings.push(...(payload.warnings ?? []));
  const clientOk = result.code === 0 && payload.ok === true;
  if (!clientOk) {
    const failed = (payload.steps ?? []).find((step) => !step.ok);
    warnings.push(`${answers.client.target} apply failed${failed ? ` at ${failed.id}: ${failed.stderr?.trim()}` : ""}`);
  }

  fs.removeSync(tempDir);
  return {
    schemaVersion: 1,
    ok: clientOk,
    root,
    api: { mode: answers.api.existing ? "existing" : "create", directory: apiDir, ...(apiOutput ? { output: apiOutput } : {}) },
    client: {
      target: answers.client.target,
      directory: clientDir,
      ...(clientOk ? { output: payload } : { error: result.stderr || result.stdout }),
    },
    contract: { file: clientContract, preset: contract.preset, presetHash: contract.presetHash },
    warnings,
  };
}
