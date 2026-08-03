import path from "path";
import fs from "fs-extra";
import pc from "picocolors";
import { readConfig } from "../utils/config";
import { newMigrationVersion } from "../utils/migrations";
import { toDbName } from "../utils/naming";
import { promptMigrationName } from "../prompts/generate-wizard";

// generate migration doesn't know your schema, so unlike `generate module`
// it can't render real SQL — it only reserves the timestamped filename pair
// so two people adding a migration on the same day never collide, and stubs
// each with a TODO instead of leaving the CLI to guess at columns.
export async function generateMigration(rawName: string | undefined, projectDir: string = process.cwd()): Promise<void> {
  readConfig(projectDir); // throws with a clear message if this isn't a go-scaffold project

  const name = toDbName(rawName ?? (await promptMigrationName()));
  if (!name) {
    throw new Error(`invalid migration name: "${rawName}" (must contain letters/numbers)`);
  }

  const migrationsDir = path.join(projectDir, "migrations");
  fs.ensureDirSync(migrationsDir);
  const version = newMigrationVersion(migrationsDir);

  const upPath = path.join(migrationsDir, `${version}_${name}.up.sql`);
  const downPath = path.join(migrationsDir, `${version}_${name}.down.sql`);
  fs.writeFileSync(upPath, `-- TODO: write the up migration for ${name}\n`);
  fs.writeFileSync(downPath, `-- TODO: write the down migration for ${name} (reverses the up migration)\n`);

  console.log(pc.green(`\ngenerated migrations/${version}_${name}.{up,down}.sql`));
  console.log(
    pc.dim(
      `\nnext: write the SQL, then \`make migrate-up\` (dev) or apply it as a deploy step ` +
        `(AUTO_MIGRATE=true also picks up model changes automatically in dev — this file matters most for prod)`
    )
  );
}
