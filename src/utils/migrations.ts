import fs from "fs-extra";

// golang-migrate timestamp numbering — the same convention as the CLI's own
// `migrate create -ext sql -dir migrations -seq=false <name>`: a 14-digit
// UTC timestamp (YYYYMMDDHHMMSS). Two people branching from the same base and
// each adding a migration get different filenames instead of both claiming
// the next sequential number and colliding on merge. golang-migrate orders
// by the numeric prefix either way, and a 14-digit timestamp always sorts
// after any existing 6-digit sequential number, so a project with old-style
// numbers already in migrations/ is safe to keep generating into.
export function newMigrationVersion(migrationsDir: string): string {
  const existing = new Set(
    (fs.existsSync(migrationsDir) ? fs.readdirSync(migrationsDir) : [])
      .map((f) => f.match(/^(\d+)_/))
      .filter((m): m is RegExpMatchArray => m !== null)
      .map((m) => m[1])
  );

  let d = new Date();
  let version = formatVersion(d);
  // Vanishingly unlikely in normal (human-driven) use, but guard the
  // same-second edge case rather than silently overwrite a sibling file.
  while (existing.has(version)) {
    d = new Date(d.getTime() + 1000);
    version = formatVersion(d);
  }
  return version;
}

function formatVersion(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    String(d.getUTCFullYear()) +
    pad(d.getUTCMonth() + 1) +
    pad(d.getUTCDate()) +
    pad(d.getUTCHours()) +
    pad(d.getUTCMinutes()) +
    pad(d.getUTCSeconds())
  );
}
