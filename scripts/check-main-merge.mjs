#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const scriptArgs = process.argv.slice(2).filter((arg) => arg !== "--");
const baseRef = scriptArgs[0] ?? process.env.BASE_REF ?? "origin/main";
const headBranch = scriptArgs[1] ?? process.env.HEAD_BRANCH ?? "";

function git(...args) {
  return execFileSync("git", args, {
    cwd: root,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

function fail(message) {
  console.error(`main merge policy failed: ${message}`);
  process.exit(1);
}

if (scriptArgs.length > 2) {
  fail("expected [base-ref] [head-branch]");
}

if (headBranch !== "develop" && !headBranch.startsWith("release/")) {
  fail(
    `PR branch must be develop or release/*, got ${headBranch || "(unknown)"}`,
  );
}

function readPackage(ref) {
  try {
    return JSON.parse(git("show", `${ref}:package.json`));
  } catch {
    fail(`could not read package.json from ${ref}`);
  }
}

const basePackage = readPackage(baseRef);
const headPackage = readPackage("HEAD");

const semverPattern =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;

function parseVersion(version, label) {
  const match = semverPattern.exec(version);
  if (!match) fail(`${label} has invalid semver ${version}`);
  return {
    core: match.slice(1, 4).map(Number),
    prerelease: match[4] ? match[4].split(".") : [],
  };
}

function compareVersions(left, right) {
  for (let index = 0; index < left.core.length; index += 1) {
    if (left.core[index] !== right.core[index]) {
      return left.core[index] > right.core[index] ? 1 : -1;
    }
  }

  if (left.prerelease.length === 0 && right.prerelease.length > 0) return 1;
  if (left.prerelease.length > 0 && right.prerelease.length === 0) return -1;

  for (
    let index = 0;
    index < Math.max(left.prerelease.length, right.prerelease.length);
    index += 1
  ) {
    const leftPart = left.prerelease[index];
    const rightPart = right.prerelease[index];
    if (leftPart === undefined) return -1;
    if (rightPart === undefined) return 1;
    if (leftPart === rightPart) continue;

    const leftNumeric = /^\d+$/.test(leftPart);
    const rightNumeric = /^\d+$/.test(rightPart);
    if (leftNumeric && rightNumeric)
      return Number(leftPart) > Number(rightPart) ? 1 : -1;
    if (leftNumeric !== rightNumeric) return leftNumeric ? -1 : 1;
    return leftPart > rightPart ? 1 : -1;
  }

  return 0;
}

const baseVersion = parseVersion(basePackage.version, "main");
const headVersion = parseVersion(headPackage.version, "PR");
if (compareVersions(headVersion, baseVersion) <= 0) {
  fail(
    `package.json must bump from ${basePackage.version} to a higher version, got ${headPackage.version}`,
  );
}

if (
  headBranch.startsWith("release/") &&
  headBranch !== `release/v${headPackage.version}`
) {
  fail(
    `release branch must be release/v${headPackage.version}, got ${headBranch}`,
  );
}

console.log(
  `main merge policy passed: ${headBranch} -> main (${basePackage.version} -> ${headPackage.version})`,
);
