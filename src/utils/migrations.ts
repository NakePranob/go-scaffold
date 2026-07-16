import fs from "fs-extra";

// golang-migrate sequential numbering: 000001, 000002, ...
export function nextMigrationSeq(migrationsDir: string): string {
  const files = fs.existsSync(migrationsDir) ? fs.readdirSync(migrationsDir) : [];
  const nums = files
    .map((f) => f.match(/^(\d+)_/))
    .filter((m): m is RegExpMatchArray => m !== null)
    .map((m) => parseInt(m[1], 10));
  const next = (nums.length ? Math.max(...nums) : 0) + 1;
  return String(next).padStart(6, "0");
}
