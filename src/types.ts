/**
 * Where background jobs are stored.
 * - "river": rows in the project's own Postgres. A job is only delivered if
 *   the transaction that enqueued it commits, and there is no second service
 *   to run. The default.
 * - "asynq": Redis. Higher throughput and shareable across languages, but the
 *   enqueue cannot join a database transaction (see the adapter's warning).
 */
export type QueueBackend = "river" | "asynq";

/**
 * Where `add auth` keeps refresh tokens and its rate-limit counters. Recovery
 * tokens always use Postgres so reset/verification can share a transaction
 * with the user update. The two selectable concerns travel together on
 * purpose — picking Redis is one decision ("I want this exact across pods"),
 * not two.
 * - "postgres": rows in the project's own database, rate limiting in-process.
 *   No service beyond Postgres. The default.
 * - "redis": what every project before this option got. Exact across replicas,
 *   at the cost of running Redis.
 */
export type AuthStore = "postgres" | "redis";

/**
 * How the browser frontend and generated API are deployed relative to one
 * another. This is an application cookie/CORS policy, not an OAuth protocol
 * value.
 */
export type BrowserTopology = "same-origin" | "same-site" | "cross-site";

/**
 * The architecture choices the generator can currently emit. Keep this
 * deliberately small: a config value is a promise that the templates and
 * their tests support the combination.
 */
export type ArchitectureStyle = "modular-monolith";
export type ArchitectureBoundary = "hexagonal";
export type PackageLayout = "split";
export type ModuleSurface = "minimal" | "crud";
export type ApplicationStyle = "service" | "cqrs";
/**
 * Named module presets exposed by the wizard. "advanced" is intentionally
 * not stored in config: it means the user chose the two underlying axes
 * independently, so the resolved surface/style remain the source of truth.
 */
export type ModuleProfile = "lean" | "crud" | "cqrs";

export interface ArchitectureConfig {
  style: ArchitectureStyle;
  /** Ports and adapters inside every module. */
  boundary: ArchitectureBoundary;
  /** Physical package layout: domain/application/ports/adapters. */
  packageLayout: PackageLayout;
  defaultModuleSurface: ModuleSurface;
  defaultApplicationStyle: ApplicationStyle;
}

export interface ModuleConfig {
  surface: ModuleSurface;
  applicationStyle: ApplicationStyle;
  boundary: ArchitectureBoundary;
  packageLayout: PackageLayout;
}

export const DEFAULT_ARCHITECTURE_CONFIG: ArchitectureConfig = {
  style: "modular-monolith",
  boundary: "hexagonal",
  packageLayout: "split",
  defaultModuleSurface: "minimal",
  defaultApplicationStyle: "service",
};

export interface ProjectFeatures {
  docker: boolean;
  openapiDocs: boolean;
  /** set by `go-scaffold add worker` — queue/mail + cmd/worker exist */
  worker?: boolean;
  /** which backing store `add worker` chose for the queue */
  queue?: QueueBackend;
  /** set by `go-scaffold add auth` — internal/app/user + auth middleware exist */
  auth?: boolean;
  /** which backing store `add auth` chose for tokens + rate limiting */
  authStore?: AuthStore;
  /** set by `go-scaffold add rbac` — internal/app/role + authz middleware exist */
  rbac?: boolean;
  /** chosen at `create` time — Prometheus /metrics + OpenTelemetry tracing (Gin + GORM) */
  observability?: boolean;
}

export interface ProjectConfig {
  /** Version of the go-scaffold project config schema, not the CLI version. */
  schemaVersion: number;
  projectName: string;
  goModule: string;
  /** URL prefix every route is grouped under, e.g. "v1" -> /v1/orders. "" means no prefix. */
  apiPrefix: string;
  features: ProjectFeatures;
  architecture: ArchitectureConfig;
  /** Resolved choices recorded for each generated module, keyed by Go package name. */
  modules: Record<string, ModuleConfig>;
  /**
   * CLI version that scaffolded this project. Optional: projects created
   * before this was stamped (and the go.mod-based fallback in detectConfig)
   * don't have one — it's a diagnostic shown when generated code fails to
   * compile, not something to branch behavior on.
   */
  scaffoldVersion?: string;
}

export interface ModuleNaming {
  /** canonical singular kebab name (e.g. "order-item") */
  name: string;
  /** Go package name — singular, lowercase, no separators (e.g. "orderitem") */
  pkg: string;
  /** Singular Go exported type name (e.g. "OrderItem") */
  pascalName: string;
  /** plural kebab name used for REST routes/docs (e.g. "order-items") */
  plural: string;
  /** plural snake_case database table name (e.g. "order_items") */
  tableName: string;
  /**
   * Postgres schema this module's tables live in, e.g. "orderitem_svc". Every
   * generated module gets its own: a domain's migration only ever creates
   * DDL inside its own schema, and a cross-schema FK is still fine (see
   * docs/architect/patterns.md's FK rules) — what this buys is that "which
   * migration owns this table" is never ambiguous, and a domain can rename
   * its own columns without grepping the rest of the project for a raw SQL
   * JOIN into them.
   */
  schemaName: string;
  /** SCREAMING_SNAKE prefix for error codes (e.g. "ORDER") */
  errorPrefix: string;
}

export type MethodType = "get" | "post" | "put" | "patch" | "delete";
export type GetMethodMode = "all" | "one";

export interface MethodNaming {
  /** raw name as passed on the CLI, trimmed (e.g. "approve") */
  name: string;
  /** exported Service method name (e.g. "Approve", "FindActive") */
  pascalName: string;
  /** unexported Handler method name (e.g. "approve", "findActive") */
  handlerName: string;
  /** URL path segment (e.g. "approve", "find-active") */
  pathSegment: string;
}
