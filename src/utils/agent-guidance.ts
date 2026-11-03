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

/**
 * A stable, package-scoped skill name. A repository-root project keeps the
 * historical `go-scaffold` name; a nested monorepo package gets a suffix from
 * its repo-relative path so two generated services cannot overwrite each
 * other's skill.
 */
export function agentSkillName(projectDir: string, repoRoot = findRepoRoot(projectDir)): string {
  const relative = toPosix(path.relative(repoRoot, path.resolve(projectDir))).replace(/^\.\/?$/, "");
  if (!relative) return "go-scaffold";
  const slug = relative
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug ? `go-scaffold-${slug}` : "go-scaffold";
}

export interface AgentSkillResult {
  files: string[];
  link: string;
  note?: string;
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

  for (const [relativePath, contents] of Object.entries(files)) {
    const target = path.join(skillDir, ...relativePath.split("/"));
    fs.ensureDirSync(path.dirname(target));
    fs.writeFileSync(target, contents);
    written.push(toPosix(path.relative(projectDir, target)) || ".");
  }

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
    return {
      files: written,
      link,
      note: `${toPosix(path.relative(projectDir, link))} already exists; left untouched`,
    };
  }

  fs.ensureDirSync(path.dirname(link));
  try {
    fs.symlinkSync(linkTarget, link, "dir");
    return { files: written, link, note: `${toPosix(path.relative(projectDir, link))} -> ${linkTarget}` };
  } catch {
    // Windows can refuse directory symlinks without developer mode. Keep the
    // portable .agents copy authoritative and give Claude Code a real copy.
    for (const [relativePath, contents] of Object.entries(files)) {
      const target = path.join(link, ...relativePath.split("/"));
      fs.ensureDirSync(path.dirname(target));
      fs.writeFileSync(target, contents);
      written.push(toPosix(path.relative(projectDir, target)) || ".");
    }
    return { files: written, link, note: `${toPosix(path.relative(projectDir, link))} (copied; symlink unavailable)` };
  }
}

function lstatOrNull(target: string): fs.Stats | null {
  try {
    return fs.lstatSync(target);
  } catch {
    return null;
  }
}
