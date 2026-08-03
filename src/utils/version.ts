import path from "path";
import nodeFs from "fs";
import fs from "fs-extra";

// cliVersion reads this CLI's own version out of its package.json — one source
// of truth for `--version`, for the stamp written into a new project's
// go-scaffold.config.json, and for the drift diagnostic that compares the two.
// Same two-candidate lookup as getTemplatesRoot (dist/ when installed, src/
// when running from a checkout).
export function cliVersion(): string {
  const candidates = [
    path.join(__dirname, "..", "..", "package.json"),
    path.join(__dirname, "..", "..", "..", "package.json"),
  ];
  const resolved = candidates.find((candidate) => nodeFs.existsSync(candidate));
  if (!resolved) throw new Error("unable to locate package.json");
  return fs.readJsonSync(resolved).version as string;
}
