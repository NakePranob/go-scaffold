import path from "path";
import fs from "fs-extra";
import { cliVersion } from "../utils/version";

const BOOTSTRAP_SKILL = `---
name: go-scaffold-bootstrap
description: Create or extend a go-scaffold project through the CLI's machine-readable interview, plan, and apply flow. Use before a project exists or when the user asks an agent to scaffold a backend.
---

# go-scaffold bootstrap

Use this skill when the user asks you to create a go-scaffold project, or when
no \`go-scaffold.config.json\` exists yet.

The CLI is the source of truth for the questions and the supported HTTP
presets. Do not invent options or hardcode the question list.

1. Run \`npx @nakedev/go-scaffold interview --json\` (or
   \`go-scaffold interview --json\` when installed).
2. Ask the user one question at a time in their language. Use the question's
   \`description\`, \`default\`, \`recommended\`, and \`why\`. If the user does not
   know, choose the recommended option and explain the trade-off.
3. Write \`answers.json\` with the question IDs and the user's answers.
4. Run \`go-scaffold create --answers answers.json --plan\`. Show the resolved
   HTTP contract, project name, and file count. Wait for confirmation.
5. Run \`go-scaffold create --answers answers.json --apply\`, then
   \`go-scaffold check\` in the new project.
6. For later work, read the generated project skill at
   \`.agents/skills/go-scaffold/SKILL.md\` and the project's
   \`docs/architect/http-contract.md\`.

Never pass an HTTP shape the CLI did not return. A shape outside the catalog
is a CLI change, not an agent guess.
`;

export function printBootstrapSkill(json = false): void {
  if (json) {
    console.log(JSON.stringify({
      schemaVersion: 1,
      name: "go-scaffold-bootstrap",
      cliVersion: cliVersion(),
      content: BOOTSTRAP_SKILL,
    }, null, 2));
    return;
  }
  console.log(BOOTSTRAP_SKILL);
}

export function installBootstrapSkill(): void {
  const root = process.cwd();
  const agentsFile = path.join(root, ".agents", "skills", "go-scaffold-bootstrap", "SKILL.md");
  fs.ensureDirSync(path.dirname(agentsFile));
  fs.writeFileSync(agentsFile, BOOTSTRAP_SKILL);
  const claudeDir = path.join(root, ".claude", "skills");
  fs.ensureDirSync(claudeDir);
  const link = path.join(claudeDir, "go-scaffold-bootstrap");
  if (!fs.existsSync(link)) {
    fs.symlinkSync(path.relative(claudeDir, path.dirname(agentsFile)), link, "dir");
  }
  console.log(`installed ${agentsFile}`);
  console.log(`linked ${link}`);
}
