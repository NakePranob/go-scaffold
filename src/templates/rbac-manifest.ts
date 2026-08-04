// output paths are relative to the project root
export const RBAC_FILES: { template: string; output: string }[] = [
  { template: "add/rbac/internal/shared/middleware/authz.go.hbs", output: "internal/shared/middleware/authz.go" },
  { template: "add/rbac/internal/shared/middleware/authz_test.go.hbs", output: "internal/shared/middleware/authz_test.go" },
  { template: "add/rbac/internal/app/role/model/role.go.hbs", output: "internal/app/role/model/role.go" },
  { template: "add/rbac/internal/app/role/model/permission.go.hbs", output: "internal/app/role/model/permission.go" },
  { template: "add/rbac/internal/app/role/model/role_permission.go.hbs", output: "internal/app/role/model/role_permission.go" },
  { template: "add/rbac/internal/app/role/repository.go.hbs", output: "internal/app/role/repository.go" },
  { template: "add/rbac/internal/app/role/service.go.hbs", output: "internal/app/role/service.go" },
  { template: "add/rbac/internal/app/role/service_test.go.hbs", output: "internal/app/role/service_test.go" },
  { template: "add/rbac/internal/app/role/handler.go.hbs", output: "internal/app/role/handler.go" },
  { template: "add/rbac/internal/app/role/dto.go.hbs", output: "internal/app/role/dto.go" },
  { template: "add/rbac/internal/app/role/errors.go.hbs", output: "internal/app/role/errors.go" },
];
