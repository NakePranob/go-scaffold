import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(path.dirname(path.dirname(fileURLToPath(import.meta.url))));
const CLI = path.join(ROOT, "bin", "go-scaffold.js");

function runCLI(cwd, ...args) {
  return execFileSync("node", [CLI, ...args], {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function read(project, relativePath) {
  return readFileSync(path.join(project, relativePath), "utf8");
}

test("generated AI guidance documents the current architecture and safety contracts", () => {
  const scratch = mkdtempSync(path.join(tmpdir(), "go-scaffold-ai-guidance-"));
  try {
    runCLI(scratch, "create", "sample", "--defaults", "--no-docker", "--api-prefix", "v1");
    const project = path.join(scratch, "sample");
    const agents = read(project, "AGENTS.md");
    const skill = read(project, ".claude/skills/go-scaffold/SKILL.md");

    assert.match(agents, /modular\s+monolith/);
    assert.match(agents, /Hexagonal Architecture/);
    assert.match(agents, /domain-oriented design/);
    assert.match(agents, /optional CQRS/);
    assert.match(agents, /feature-local [^\n]*composition\.go/);
    assert.match(agents, /APP_ENV/);
    assert.match(agents, /AUTO_MIGRATE/);
    assert.match(agents, /Production must never bootstrap or/);
    assert.match(agents, /501 Not Implemented/);
    assert.match(agents, /go test -race \.\/\.\.\./);
    assert.match(agents, /REQUIRE_TEST_DB=true/);
    assert.match(agents, /request_id/);
    assert.match(agents, /atomic consume/);
    assert.match(agents, /absolute\s+expiry never moves/);
    assert.match(agents, /one-time server-side transaction/);
    assert.match(agents, /AUTH_MFA_ENABLED=false/);
    assert.match(agents, /mfa_required/);
    assert.match(agents, /NewService\(deps Dependencies, cfg/);
    assert.match(agents, /MFA state still requires PostgreSQL/);
    assert.doesNotMatch(agents, /missing AutoMigrate wiring/);
    assert.doesNotMatch(agents, /finds the record by id, TODO before saving/);

    assert.match(skill, /feature-local composition/);
    assert.match(skill, /501 Not Implemented; no repository read\/write/);
    assert.match(skill, /Lean \(`minimal \+ service`\), CRUD \(`crud \+ service`\), CQRS/);
    assert.match(skill, /`go-scaffold generate module <name>` asks for the module profile/);
    assert.match(skill, /config show` and `config validate` are intentionally\s+read-only/);
    assert.match(skill, /APP_ENV/);
    assert.match(skill, /CQRS optional/);
    assert.match(skill, /go test -race \.\/\.\.\./);
    assert.match(skill, /pnpm run verify/);
    assert.match(skill, /REQUIRE_TEST_REDIS=true/);
    assert.match(skill, /Authentication and browser OAuth contract/);
    assert.match(skill, /GET \/auth\/\{provider\}\/login/);
    assert.match(skill, /POST \/auth\/\{provider\}\/exchange/);
    assert.match(skill, /S256 PKCE/);
    assert.match(skill, /GOOGLE_OAUTH_REDIRECT_URI/);
    assert.match(skill, /LoginProvider/);
    assert.match(skill, /oauth_denied/);
    assert.match(skill, /CORS_ALLOWED_ORIGINS/);
    assert.match(skill, /COOKIE_SAMESITE=none/);
    assert.match(skill, /COOKIE_SECURE=true/);
    assert.match(skill, /one-time server-side/);
    assert.match(skill, /OIDC/);
    assert.match(skill, /Cache-Control: no-store/);
    assert.match(skill, /exact allowed\s+`Origin`/);
    assert.match(skill, /Native\/mobile OAuth is out of scope/);
    assert.match(skill, /MFA contract/);
    assert.match(skill, /AUTH_MFA_ENABLED=false/);
    assert.match(skill, /MFA_ENCRYPTION_KEY/);
    assert.match(skill, /mfa_required/);
    assert.match(skill, /NewService\(deps Dependencies, cfg/);
    assert.match(skill, /generated Go project does not contain/);
    assert.match(skill, /MFA state is durable in Postgres/);
    assert.doesNotMatch(skill, /AUTH_FRONTEND_SUCCESS_URL|AUTH_FRONTEND_ERROR_URL|RedirectTargetResolver/);
    assert.doesNotMatch(skill, /missing AutoMigrate wiring/);
    assert.doesNotMatch(skill, /finds the record by id, TODO before saving/);

    assert.equal(read(project, "CLAUDE.md").trim(), "@AGENTS.md");
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
});
