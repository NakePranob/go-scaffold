// output paths are relative to the module's own directory.
//
// Every generated domain uses the same physical boundary. Surface and
// application style change the amount of code inside the boundary; they do
// not change where domain rules, ports, or adapters live.
const COMMON: { template: string; output: string }[] = [
  { template: "generate/module/hexagonal/domain/entity.go.hbs", output: "domain/entity.go" },
  { template: "generate/module/hexagonal/domain/errors.go.hbs", output: "domain/errors.go" },
  { template: "generate/module/hexagonal/ports/repository.go.hbs", output: "ports/repository.go" },
  {
    template: "generate/module/hexagonal/adapters/outbound/postgres/model.go.hbs",
    output: "adapters/outbound/postgres/model.go",
  },
  {
    template: "generate/module/hexagonal/adapters/outbound/postgres/repository.go.hbs",
    output: "adapters/outbound/postgres/repository.go",
  },
  {
    template: "generate/module/hexagonal/adapters/inbound/http/handler_test.go.hbs",
    output: "adapters/inbound/http/handler_test.go",
  },
  {
    template: "generate/module/hexagonal/adapters/outbound/postgres/repository_test.go.hbs",
    output: "adapters/outbound/postgres/repository_test.go",
  },
  { template: "generate/module/hexagonal/composition.go.hbs", output: "composition.go" },
];

const SERVICE_MINIMAL: { template: string; output: string }[] = [
  { template: "generate/module/hexagonal/application/dto.minimal.go.hbs", output: "application/dto.go" },
  { template: "generate/module/hexagonal/application/service.go.hbs", output: "application/service.go" },
  { template: "generate/module/hexagonal/application/service_test.go.hbs", output: "application/service_test.go" },
  {
    template: "generate/module/hexagonal/adapters/inbound/http/handler.minimal.go.hbs",
    output: "adapters/inbound/http/handler.go",
  },
];

const SERVICE_CRUD: { template: string; output: string }[] = [
  { template: "generate/module/hexagonal/application/dto.go.hbs", output: "application/dto.go" },
  { template: "generate/module/hexagonal/application/service.crud.go.hbs", output: "application/service.go" },
  { template: "generate/module/hexagonal/application/service_test.go.hbs", output: "application/service_test.go" },
  {
    template: "generate/module/hexagonal/adapters/inbound/http/handler.go.hbs",
    output: "adapters/inbound/http/handler.go",
  },
];

const CQRS_MINIMAL: { template: string; output: string }[] = [
  { template: "generate/module/hexagonal/application/dto.minimal.go.hbs", output: "application/dto.go" },
  { template: "generate/module/hexagonal/application/commands.go.hbs", output: "application/commands.go" },
  { template: "generate/module/hexagonal/application/queries.go.hbs", output: "application/queries.go" },
  {
    template: "generate/module/hexagonal/adapters/inbound/http/handler.minimal.go.hbs",
    output: "adapters/inbound/http/handler.go",
  },
  { template: "generate/module/hexagonal/application/cqrs_test.go.hbs", output: "application/cqrs_test.go" },
];

const CQRS_CRUD: { template: string; output: string }[] = [
  { template: "generate/module/hexagonal/application/dto.go.hbs", output: "application/dto.go" },
  { template: "generate/module/hexagonal/application/commands.crud.go.hbs", output: "application/commands.go" },
  { template: "generate/module/hexagonal/application/queries.crud.go.hbs", output: "application/queries.go" },
  {
    template: "generate/module/hexagonal/adapters/inbound/http/handler.go.hbs",
    output: "adapters/inbound/http/handler.go",
  },
  { template: "generate/module/hexagonal/application/cqrs_test.go.hbs", output: "application/cqrs_test.go" },
];

export const MODULE_FILES = [...COMMON, ...SERVICE_CRUD];
export const MODULE_FILES_MINIMAL = [...COMMON, ...SERVICE_MINIMAL];
export const MODULE_FILES_CQRS = [...COMMON, ...CQRS_CRUD];
export const MODULE_FILES_MINIMAL_CQRS = [...COMMON, ...CQRS_MINIMAL];
