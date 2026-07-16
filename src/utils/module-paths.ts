import fs from "fs-extra";
import path from "path";

// folder-based domain versioning lays modules out as internal/app/v<n>/<pkg>.
// listVersionFolders returns the existing v<n> dirs, sorted ascending.
export function listVersionFolders(projectDir: string): string[] {
  const appDir = path.join(projectDir, "internal", "app");
  if (!fs.existsSync(appDir)) return [];
  return fs
    .readdirSync(appDir, { withFileTypes: true })
    .filter((e) => e.isDirectory() && /^v\d+$/.test(e.name))
    .map((e) => e.name)
    .sort((a, b) => parseInt(a.slice(1), 10) - parseInt(b.slice(1), 10));
}

// version folders that actually contain the given module (identified by its
// handler.go) — a module can legitimately live in more than one version at
// once (that's the point of versioning), so callers that need exactly one
// (generate method, remove module) must pick among the matches.
export function versionsContainingModule(projectDir: string, pkg: string): string[] {
  return listVersionFolders(projectDir).filter((v) =>
    fs.existsSync(path.join(projectDir, "internal", "app", v, pkg, "handler.go"))
  );
}

export function nextVersionName(versions: string[]): string {
  const max = versions.reduce((m, v) => Math.max(m, parseInt(v.slice(1), 10) || 0), 0);
  return `v${max + 1}`;
}
