import { AuthStore } from "../types";

type Entry = { template: string; output: string };

// Auth is a complete hexagonal feature. The application package owns use
// cases and contracts, inbound owns Gin/HTTP translation, and outbound owns
// GORM/Redis details. The manifest is intentionally explicit: adding auth
// must create one canonical implementation tree.
const SHARED: Entry[] = [
  { template: "add/auth/internal/shared/middleware/auth.go.hbs", output: "internal/shared/middleware/auth.go" },
  { template: "add/auth/internal/shared/middleware/ratelimit.go.hbs", output: "internal/shared/middleware/ratelimit.go" },

  { template: "add/auth/internal/app/user/domain/entity.go.hbs", output: "internal/app/user/domain/entity.go" },
  { template: "add/auth/internal/app/user/domain/errors.go.hbs", output: "internal/app/user/domain/errors.go" },
  { template: "add/auth/internal/app/user/ports/repository.go.hbs", output: "internal/app/user/ports/repository.go" },

  { template: "add/auth/internal/app/user/application/contracts.go.hbs", output: "internal/app/user/application/contracts.go" },
  { template: "add/auth/internal/app/user/application/dto.go.hbs", output: "internal/app/user/application/dto.go" },
  { template: "add/auth/internal/app/user/application/errors.go.hbs", output: "internal/app/user/application/errors.go" },
  { template: "add/auth/internal/app/user/application/external_login.go.hbs", output: "internal/app/user/application/external_login.go" },
  { template: "add/auth/internal/app/user/application/jwt.go.hbs", output: "internal/app/user/application/jwt.go" },
  { template: "add/auth/internal/app/user/application/local_auth.go.hbs", output: "internal/app/user/application/local_auth.go" },
  { template: "add/auth/internal/app/user/application/mfa_service.go.hbs", output: "internal/app/user/application/mfa_service.go" },
  { template: "add/auth/internal/app/user/application/mfa_service_test.go.hbs", output: "internal/app/user/application/mfa_service_test.go" },
  { template: "add/auth/internal/app/user/application/oauth.go.hbs", output: "internal/app/user/application/oauth.go" },
  { template: "add/auth/internal/app/user/application/provider_test.go.hbs", output: "internal/app/user/application/provider_test.go" },
  { template: "add/auth/internal/app/user/application/recovery.go.hbs", output: "internal/app/user/application/recovery.go" },
  { template: "add/auth/internal/app/user/application/recovery_service.go.hbs", output: "internal/app/user/application/recovery_service.go" },
  { template: "add/auth/internal/app/user/application/service.go.hbs", output: "internal/app/user/application/service.go" },
  { template: "add/auth/internal/app/user/application/service_test.go.hbs", output: "internal/app/user/application/service_test.go" },
  { template: "add/auth/internal/app/user/application/sessions.go.hbs", output: "internal/app/user/application/sessions.go" },
  { template: "add/auth/internal/app/user/application/tokenstore_ports.go.hbs", output: "internal/app/user/application/tokenstore_ports.go" },
  { template: "add/auth/internal/app/user/application/user_query.go.hbs", output: "internal/app/user/application/user_query.go" },

  { template: "add/auth/internal/app/user/adapters/inbound/http/browser_policy.go.hbs", output: "internal/app/user/adapters/inbound/http/browser_policy.go" },
  { template: "add/auth/internal/app/user/adapters/inbound/http/dto.go.hbs", output: "internal/app/user/adapters/inbound/http/dto.go" },
  { template: "add/auth/internal/app/user/adapters/inbound/http/handler.go.hbs", output: "internal/app/user/adapters/inbound/http/handler.go" },
  { template: "add/auth/internal/app/user/adapters/inbound/http/handler_local.go.hbs", output: "internal/app/user/adapters/inbound/http/handler_local.go" },
  { template: "add/auth/internal/app/user/adapters/inbound/http/handler_mfa.go.hbs", output: "internal/app/user/adapters/inbound/http/handler_mfa.go" },
  { template: "add/auth/internal/app/user/adapters/inbound/http/handler_oauth.go.hbs", output: "internal/app/user/adapters/inbound/http/handler_oauth.go" },
  { template: "add/auth/internal/app/user/adapters/inbound/http/handler_recovery.go.hbs", output: "internal/app/user/adapters/inbound/http/handler_recovery.go" },
  { template: "add/auth/internal/app/user/adapters/inbound/http/handler_test.go.hbs", output: "internal/app/user/adapters/inbound/http/handler_test.go" },
  { template: "add/auth/internal/app/user/adapters/inbound/http/handler_user.go.hbs", output: "internal/app/user/adapters/inbound/http/handler_user.go" },
  { template: "add/auth/internal/app/user/adapters/inbound/http/session_cookie.go.hbs", output: "internal/app/user/adapters/inbound/http/session_cookie.go" },

  { template: "add/auth/internal/app/user/adapters/outbound/postgres/model.go.hbs", output: "internal/app/user/adapters/outbound/postgres/model.go" },
  { template: "add/auth/internal/app/user/adapters/outbound/postgres/mfa_store.go.hbs", output: "internal/app/user/adapters/outbound/postgres/mfa_store.go" },
  { template: "add/auth/internal/app/user/adapters/outbound/postgres/mfa_store_test.go.hbs", output: "internal/app/user/adapters/outbound/postgres/mfa_store_test.go" },
  { template: "add/auth/internal/app/user/adapters/outbound/postgres/repository.go.hbs", output: "internal/app/user/adapters/outbound/postgres/repository.go" },
  { template: "add/auth/internal/app/user/adapters/outbound/postgres/repository_test.go.hbs", output: "internal/app/user/adapters/outbound/postgres/repository_test.go" },
  { template: "add/auth/internal/app/user/adapters/outbound/postgres/tokenstore_recovery.go.hbs", output: "internal/app/user/adapters/outbound/postgres/tokenstore_recovery.go" },

  { template: "add/auth/internal/app/user/composition.go.hbs", output: "internal/app/user/composition.go" },
  { template: "add/auth/internal/platform/authprovider/google/google.go.hbs", output: "internal/platform/authprovider/google/google.go" },
  { template: "add/auth/internal/platform/authprovider/google/google_test.go.hbs", output: "internal/platform/authprovider/google/google_test.go" },
  { template: "add/auth/cmd/seed/main.go.hbs", output: "cmd/seed/main.go" },
];

const POSTGRES: Entry[] = [
  { template: "add/auth/internal/app/user/adapters/outbound/postgres/tokenstore_pg.go.hbs", output: "internal/app/user/adapters/outbound/postgres/tokenstore_pg.go" },
  { template: "add/auth/internal/app/user/adapters/outbound/postgres/tokenstore_pg_test.go.hbs", output: "internal/app/user/adapters/outbound/postgres/tokenstore_pg_test.go" },
  { template: "add/auth/internal/shared/middleware/ratelimit_memory.go.hbs", output: "internal/shared/middleware/ratelimit_memory.go" },
];

const REDIS: Entry[] = [
  { template: "add/auth/internal/app/user/adapters/outbound/redis/tokenstore.go.hbs", output: "internal/app/user/adapters/outbound/redis/tokenstore.go" },
  { template: "add/auth/internal/app/user/adapters/outbound/redis/tokenstore_test.go.hbs", output: "internal/app/user/adapters/outbound/redis/tokenstore_test.go" },
  { template: "add/auth/internal/shared/middleware/ratelimit_redis.go.hbs", output: "internal/shared/middleware/ratelimit_redis.go" },
];

export function authFiles(store: AuthStore): Entry[] {
  return [...SHARED, ...(store === "postgres" ? POSTGRES : REDIS)];
}
