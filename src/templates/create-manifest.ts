import { TemplateEntry } from "../utils/template-renderer";

export const CREATE_MANIFEST: TemplateEntry[] = [
  { template: "create/base/go.mod.hbs", output: "go.mod" },
  { template: "create/base/.gitignore.hbs", output: ".gitignore" },
  { template: "create/base/.env.example.hbs", output: ".env.example" },
  { template: "create/base/Makefile.hbs", output: "Makefile" },
  { template: "create/base/.golangci.yml.hbs", output: ".golangci.yml" },
  { template: "create/base/.vscode/settings.json.hbs", output: ".vscode/settings.json" },
  { template: "create/base/.github/workflows/ci.yml.hbs", output: ".github/workflows/ci.yml" },
  { template: "create/base/README.md.hbs", output: "README.md" },
  { template: "create/base/AGENTS.md.hbs", output: "AGENTS.md" },
  { template: "create/base/CLAUDE.md.hbs", output: "CLAUDE.md" },
  {
    template: "create/base/.claude/skills/go-scaffold/SKILL.md.hbs",
    output: ".claude/skills/go-scaffold/SKILL.md",
  },
  { template: "create/base/cmd/api/main.go.hbs", output: "cmd/api/main.go" },
  {
    template: "create/base/internal/platform/database/database.go.hbs",
    output: "internal/platform/database/database.go",
  },
  {
    template: "create/base/internal/shared/config/config.go.hbs",
    output: "internal/shared/config/config.go",
  },
  {
    template: "create/base/internal/shared/apperror/apperror.go.hbs",
    output: "internal/shared/apperror/apperror.go",
  },
  {
    template: "create/base/internal/shared/dberr/dberr.go.hbs",
    output: "internal/shared/dberr/dberr.go",
  },
  {
    template: "create/base/internal/shared/httpx/httpx.go.hbs",
    output: "internal/shared/httpx/httpx.go",
  },
  {
    template: "create/base/internal/shared/id/id.go.hbs",
    output: "internal/shared/id/id.go",
  },
  {
    template: "create/base/internal/shared/pagination/pagination.go.hbs",
    output: "internal/shared/pagination/pagination.go",
  },
  {
    template: "create/base/internal/shared/middleware/error.go.hbs",
    output: "internal/shared/middleware/error.go",
  },
  {
    template: "create/base/internal/shared/middleware/logger.go.hbs",
    output: "internal/shared/middleware/logger.go",
  },
  {
    template: "create/base/internal/shared/middleware/requestid.go.hbs",
    output: "internal/shared/middleware/requestid.go",
  },
  { template: "create/base/migrations/.gitkeep.hbs", output: "migrations/.gitkeep" },

  // architecture standards docs — always included, this is the point of the CLI
  {
    template: "create/features/docs/architecture.md.hbs",
    output: "docs/architect/architecture.md",
  },
  {
    template: "create/features/docs/patterns.md.hbs",
    output: "docs/architect/patterns.md",
  },
  {
    template: "create/features/docs/techstack.md.hbs",
    output: "docs/architect/techstack.md",
  },

  // opt-in features
  {
    template: "create/features/docker-compose.yml.hbs",
    output: "docker-compose.yml",
    when: (ctx) => ctx.docker,
  },
  {
    template: "create/features/docs/openapi.yaml.hbs",
    output: "docs/openapi.yaml",
    when: (ctx) => ctx.openapiDocs,
  },
  {
    template: "create/features/docs/common/parameters.yaml.hbs",
    output: "docs/common/parameters.yaml",
    when: (ctx) => ctx.openapiDocs,
  },
  {
    template: "create/features/docs/common/responses.yaml.hbs",
    output: "docs/common/responses.yaml",
    when: (ctx) => ctx.openapiDocs,
  },
  {
    template: "create/features/docs/common/schemas.yaml.hbs",
    output: "docs/common/schemas.yaml",
    when: (ctx) => ctx.openapiDocs,
  },
  {
    template: "create/features/docs/health/health-livez.yaml.hbs",
    output: "docs/health/health-livez.yaml",
    when: (ctx) => ctx.openapiDocs,
  },
  {
    template: "create/features/docs/health/health-readyz.yaml.hbs",
    output: "docs/health/health-readyz.yaml",
    when: (ctx) => ctx.openapiDocs,
  },
];
