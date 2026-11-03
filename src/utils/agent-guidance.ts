import path from "path";
import fs from "fs-extra";

/** The git repository root at or above `projectDir`, or `projectDir` itself. */
export function findRepoRoot(projectDir: string): string {
  let dir = path.resolve(projectDir);
  for (;;) {
    if (fs.existsSync(path.join(dir, ".git"))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) return path.resolve(projectDir);
    dir = parent;
  }
}

export function toPosix(value: string): string {
  return value.split(path.sep).join("/");
}

/** The one repository-wide skill every generated package shares. */
export const AGENT_SKILL_NAME = "go-scaffold";

export interface AgentSkillResult {
  files: string[];
  link: string;
  note?: string;
}

/**
 * Refuse to silently replace a different skill with the same name.
 *
 * The skill is repository-wide, so every package in a monorepo maps to the
 * same file. The same CLI version renders identical content; a different
 * version, or a hand-edited file, means two sources of truth and is reported
 * instead of silently choosing the newer run.
 */
export function assertAgentSkillAvailable(projectDir: string, name: string, content: string): void {
  const repoRoot = findRepoRoot(projectDir);
  const skillFile = path.join(repoRoot, ".agents", "skills", name, "SKILL.md");
  if (!fs.existsSync(skillFile)) return;
  if (fs.readFileSync(skillFile, "utf8") === content) return;
  throw new Error(
    `agent skill "${name}" already exists at ${toPosix(path.relative(projectDir, skillFile))} with different content — ` +
      `it was written by a different CLI version or edited by hand; update or remove it, then run create again`
  );
}

/**
 * Write the real skill under `<repo-root>/.agents/skills/<name>/` and expose it
 * to Claude Code through `.claude/skills/<name>`. Agent tooling reads these
 * directories from the repository root, not from a monorepo package folder.
 */
export function writeAgentSkill(
  projectDir: string,
  name: string,
  files: Record<string, string>
): AgentSkillResult {
  const repoRoot = findRepoRoot(projectDir);
  const skillDir = path.join(repoRoot, ".agents", "skills", name);
  const written: string[] = [];
  const skillContent = files["SKILL.md"];

  if (skillContent !== undefined) assertAgentSkillAvailable(projectDir, name, skillContent);
  writeFiles(projectDir, skillDir, files, written);

  const link = path.join(repoRoot, ".claude", "skills", name);
  const linkTarget = path.join("..", "..", ".agents", "skills", name);
  const existing = lstatOrNull(link);

  if (existing?.isSymbolicLink()) {
    const current = fs.readlinkSync(link);
    if (path.resolve(path.dirname(link), current) === path.resolve(skillDir)) {
      return { files: written, link, note: `${toPosix(path.relative(projectDir, link))} -> ${linkTarget}` };
    }
    fs.unlinkSync(link);
  } else if (existing) {
    if (!existing.isDirectory()) {
      return {
        files: written,
        link,
        note: `${toPosix(path.relative(projectDir, link))} already exists and is not a directory; left untouched`,
      };
    }
    // Windows can leave a real copy from an earlier run. Refresh it from the
    // authoritative .agents tree instead of returning a silently stale skill.
    writeFiles(projectDir, link, files, written);
    return {
      files: written,
      link,
      note: `${toPosix(path.relative(projectDir, link))} refreshed real copy (symlink unavailable earlier)`,
    };
  }

  fs.ensureDirSync(path.dirname(link));
  try {
    fs.symlinkSync(linkTarget, link, "dir");
    return { files: written, link, note: `${toPosix(path.relative(projectDir, link))} -> ${linkTarget}` };
  } catch {
    // Windows can refuse directory symlinks without developer mode. Keep the
    // portable .agents copy authoritative and give Claude Code a real copy.
    writeFiles(projectDir, link, files, written);
    return { files: written, link, note: `${toPosix(path.relative(projectDir, link))} (copied; symlink unavailable)` };
  }
}

function writeFiles(
  projectDir: string,
  destination: string,
  files: Record<string, string>,
  written: string[]
): void {
  for (const [relativePath, contents] of Object.entries(files)) {
    const target = path.join(destination, ...relativePath.split("/"));
    fs.ensureDirSync(path.dirname(target));
    fs.writeFileSync(target, contents);
    written.push(toPosix(path.relative(projectDir, target)) || ".");
  }
}

function lstatOrNull(target: string): fs.Stats | null {
  try {
    return fs.lstatSync(target);
  } catch {
    return null;
  }
}
