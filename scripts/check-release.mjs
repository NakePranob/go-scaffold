#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const packageJson = JSON.parse(
  readFileSync(resolve(root, "package.json"), "utf8"),
);
// pnpm keeps the argument separator when it invokes a script (`-- tag`), so
// accept both `node scripts/check-release.mjs v0.4.1` and
// `pnpm run release:check -- v0.4.1`.
const scriptArgs = process.argv.slice(2).filter((arg) => arg !== "--");
const requestedTag = scriptArgs[0] ?? process.env.RELEASE_TAG;

function git(...args) {
  return execFileSync("git", args, {
    cwd: root,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

function fail(message) {
  console.error(`release check failed: ${message}`);
  process.exit(1);
}

if (scriptArgs.length > 1) {
  fail("expected at most one tag argument, for example v0.4.1");
}

let tag = requestedTag;
if (!tag) {
  const tagsAtHead = git("tag", "--points-at", "HEAD", "--list", "v*.*.*")
    .split("\n")
    .map((value) => value.trim())
    .filter(Boolean);

  if (tagsAtHead.length !== 1) {
    fail(
      tagsAtHead.length === 0
        ? "HEAD has no release tag; publish only from an exact vX.Y.Z tag"
        : `HEAD has multiple release tags: ${tagsAtHead.join(", ")}`,
    );
  }
  tag = tagsAtHead[0];
}

if (
  !/^v(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/.test(
    tag,
  )
) {
  fail(`"${tag}" is not a valid release tag; expected vX.Y.Z`);
}

const expectedVersion = tag.slice(1);
if (packageJson.version !== expectedVersion) {
  fail(
    `package.json has ${packageJson.version}, but ${tag} requires ${expectedVersion}`,
  );
}

let tagType;
let tagCommit;
try {
  tagType = git("cat-file", "-t", `refs/tags/${tag}`);
  tagCommit = git("rev-parse", `refs/tags/${tag}^{commit}`);
} catch {
  fail(`tag ${tag} is not available in this checkout`);
}

if (tagType !== "tag") {
  fail(`${tag} must be an annotated tag; lightweight tags are not accepted`);
}

const head = git("rev-parse", "HEAD");
if (tagCommit !== head) {
  fail(
    `${tag} points to ${tagCommit.slice(0, 12)}, but HEAD is ${head.slice(0, 12)}`,
  );
}

if (git("status", "--porcelain")) {
  fail("working tree is not clean");
}

console.log(
  `release check passed: ${packageJson.name}@${packageJson.version} <- ${tag} (${head.slice(0, 12)})`,
);
