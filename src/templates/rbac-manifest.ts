// output paths are relative to the project root. RBAC uses the same
// hexagonal split as every other generated module; there is one role
// implementation, not a public wrapper around duplicated code.
export const RBAC_FILES: { template: string; output: string }[] = [
  { template: "add/rbac/internal/shared/middleware/authz.go.hbs", output: "internal/shared/middleware/authz.go" },
  { template: "add/rbac/internal/shared/middleware/authz_test.go.hbs", output: "internal/shared/middleware/authz_test.go" },

  { template: "add/rbac/internal/app/role/domain/entity.go.hbs", output: "internal/app/role/domain/entity.go" },
  { template: "add/rbac/internal/app/role/domain/errors.go.hbs", output: "internal/app/role/domain/errors.go" },
  { template: "add/rbac/internal/app/role/ports/repository.go.hbs", output: "internal/app/role/ports/repository.go" },

  { template: "add/rbac/internal/app/role/application/dto.go.hbs", output: "internal/app/role/application/dto.go" },
  { template: "add/rbac/internal/app/role/application/errors.go.hbs", output: "internal/app/role/application/errors.go" },
  { template: "add/rbac/internal/app/role/application/service.go.hbs", output: "internal/app/role/application/service.go" },
  { template: "add/rbac/internal/app/role/application/service_test.go.hbs", output: "internal/app/role/application/service_test.go" },

  { template: "add/rbac/internal/app/role/adapters/inbound/http/handler.go.hbs", output: "internal/app/role/adapters/inbound/http/handler.go" },
  { template: "add/rbac/internal/app/role/adapters/inbound/http/handler_test.go.hbs", output: "internal/app/role/adapters/inbound/http/handler_test.go" },
  { template: "add/rbac/internal/app/role/adapters/outbound/postgres/model.go.hbs", output: "internal/app/role/adapters/outbound/postgres/model.go" },
  { template: "add/rbac/internal/app/role/adapters/outbound/postgres/repository.go.hbs", output: "internal/app/role/adapters/outbound/postgres/repository.go" },
  { template: "add/rbac/internal/app/role/adapters/outbound/postgres/repository_test.go.hbs", output: "internal/app/role/adapters/outbound/postgres/repository_test.go" },

  { template: "add/rbac/internal/app/role/composition.go.hbs", output: "internal/app/role/composition.go" },
];
