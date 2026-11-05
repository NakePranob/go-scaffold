import path from "path";
import fs from "fs-extra";
import { readConfig } from "../utils/config";
import { ResolvedHttpContract } from "../types";

export interface HttpContractArtifact {
  schemaVersion: 1;
  projectName: string;
  goModule: string;
  apiPrefix: string;
  preset: string;
  resolved: ResolvedHttpContract;
  presetHash: string;
}

export function contractArtifact(projectDir: string = process.cwd()): HttpContractArtifact {
  const config = readConfig(projectDir);
  return {
    schemaVersion: 1,
    projectName: config.projectName,
    goModule: config.goModule,
    apiPrefix: config.apiPrefix,
    preset: config.http.preset,
    resolved: config.http.resolved,
    presetHash: config.http.presetHash,
  };
}

export function contractPath(projectDir: string = process.cwd()): string {
  return path.join(projectDir, "http-contract.json");
}

export function writeContractArtifact(projectDir: string = process.cwd()): string {
  const file = contractPath(projectDir);
  fs.writeJsonSync(file, contractArtifact(projectDir), { spaces: 2 });
  return file;
}

export interface ContractExportOptions {
  out?: string;
  json?: boolean;
}

export function exportContract(options: ContractExportOptions = {}): void {
  const artifact = contractArtifact();
  if (options.out) {
    const file = path.resolve(options.out);
    fs.ensureDirSync(path.dirname(file));
    fs.writeJsonSync(file, artifact, { spaces: 2 });
    console.error(`wrote ${file}`);
  }
  console.log(JSON.stringify(artifact, null, 2));
}

