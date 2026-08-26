// output paths are relative to the module's own directory
// (internal/app/<pkg> or internal/app/v<version>/<pkg>)
export const MODULE_FILES: { template: string; output: string }[] = [
  { template: "generate/module/model/model.go.hbs", output: "model/model.go" },
  { template: "generate/module/dto.go.hbs", output: "dto.go" },
  { template: "generate/module/errors.go.hbs", output: "errors.go" },
  { template: "generate/module/repository.go.hbs", output: "repository.go" },
  { template: "generate/module/service.go.hbs", output: "service.go" },
  { template: "generate/module/composition.go.hbs", output: "composition.go" },
  { template: "generate/module/handler.go.hbs", output: "handler.go" },
  { template: "generate/module/service_test.go.hbs", output: "service_test.go" },
  { template: "generate/module/handler_test.go.hbs", output: "handler_test.go" },
  { template: "generate/module/repository_test.go.hbs", output: "repository_test.go" },
];

// CQRS is opt-in so a simple CRUD module does not pay for command/query
// ceremony. The implementation files are still in the feature package, which
// keeps the module easy to adopt incrementally and lets `generate method` patch
// the correct side later.
export const MODULE_FILES_CQRS: { template: string; output: string }[] = [
  { template: "generate/module/model/model.go.hbs", output: "model/model.go" },
  { template: "generate/module/dto.go.hbs", output: "dto.go" },
  { template: "generate/module/errors.go.hbs", output: "errors.go" },
  { template: "generate/module/repository.go.hbs", output: "repository.go" },
  { template: "generate/module/commands.go.hbs", output: "commands.go" },
  { template: "generate/module/queries.go.hbs", output: "queries.go" },
  { template: "generate/module/service.go.hbs", output: "service.go" },
  { template: "generate/module/composition.go.hbs", output: "composition.go" },
  { template: "generate/module/handler.go.hbs", output: "handler.go" },
  { template: "generate/module/service_test.go.hbs", output: "service_test.go" },
  { template: "generate/module/handler_test.go.hbs", output: "handler_test.go" },
  { template: "generate/module/repository_test.go.hbs", output: "repository_test.go" },
  { template: "generate/module/cqrs_test.go.hbs", output: "cqrs_test.go" },
];

// minimal: same model/errors/repository (generate method's patches assume the
// full data-access surface exists), but no default CRUD in dto/service/handler
// — add endpoints one at a time with `generate method`.
export const MODULE_FILES_MINIMAL: { template: string; output: string }[] = [
  { template: "generate/module/model/model.go.hbs", output: "model/model.go" },
  { template: "generate/module/minimal/dto.go.hbs", output: "dto.go" },
  { template: "generate/module/errors.go.hbs", output: "errors.go" },
  { template: "generate/module/repository.go.hbs", output: "repository.go" },
  { template: "generate/module/minimal/service.go.hbs", output: "service.go" },
  { template: "generate/module/composition.go.hbs", output: "composition.go" },
  { template: "generate/module/minimal/handler.go.hbs", output: "handler.go" },
  { template: "generate/module/minimal/service_test.go.hbs", output: "service_test.go" },
  { template: "generate/module/minimal/handler_test.go.hbs", output: "handler_test.go" },
  { template: "generate/module/repository_test.go.hbs", output: "repository_test.go" },
];

export const MODULE_FILES_MINIMAL_CQRS: { template: string; output: string }[] = [
  { template: "generate/module/model/model.go.hbs", output: "model/model.go" },
  { template: "generate/module/minimal/dto.go.hbs", output: "dto.go" },
  { template: "generate/module/errors.go.hbs", output: "errors.go" },
  { template: "generate/module/repository.go.hbs", output: "repository.go" },
  { template: "generate/module/minimal/commands.go.hbs", output: "commands.go" },
  { template: "generate/module/minimal/queries.go.hbs", output: "queries.go" },
  { template: "generate/module/minimal/service.go.hbs", output: "service.go" },
  { template: "generate/module/composition.go.hbs", output: "composition.go" },
  { template: "generate/module/minimal/handler.go.hbs", output: "handler.go" },
  { template: "generate/module/minimal/service_test.go.hbs", output: "service_test.go" },
  { template: "generate/module/minimal/handler_test.go.hbs", output: "handler_test.go" },
  { template: "generate/module/repository_test.go.hbs", output: "repository_test.go" },
  { template: "generate/module/cqrs_test.go.hbs", output: "cqrs_test.go" },
];
