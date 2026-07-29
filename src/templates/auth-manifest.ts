// output paths are relative to the project root
export const AUTH_FILES: { template: string; output: string }[] = [
  { template: "add/auth/internal/shared/middleware/auth.go.hbs", output: "internal/shared/middleware/auth.go" },
  { template: "add/auth/internal/app/user/model/user.go.hbs", output: "internal/app/user/model/user.go" },
  { template: "add/auth/internal/app/user/model/identity.go.hbs", output: "internal/app/user/model/identity.go" },
  { template: "add/auth/internal/app/user/dto.go.hbs", output: "internal/app/user/dto.go" },
  { template: "add/auth/internal/app/user/errors.go.hbs", output: "internal/app/user/errors.go" },
  { template: "add/auth/internal/app/user/jwt.go.hbs", output: "internal/app/user/jwt.go" },
  { template: "add/auth/internal/app/user/tokenstore.go.hbs", output: "internal/app/user/tokenstore.go" },
  { template: "add/auth/internal/app/user/repository.go.hbs", output: "internal/app/user/repository.go" },
  { template: "add/auth/internal/app/user/service.go.hbs", output: "internal/app/user/service.go" },
  { template: "add/auth/internal/app/user/handler.go.hbs", output: "internal/app/user/handler.go" },
  { template: "add/auth/cmd/seed/main.go.hbs", output: "cmd/seed/main.go" },
];
