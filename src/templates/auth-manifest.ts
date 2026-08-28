import { AuthStore } from "../types";

type Entry = { template: string; output: string };

// Everything that is the same whichever store backs the tokens.
const SHARED: Entry[] = [
  { template: "add/auth/internal/shared/middleware/auth.go.hbs", output: "internal/shared/middleware/auth.go" },
  { template: "add/auth/internal/shared/middleware/ratelimit.go.hbs", output: "internal/shared/middleware/ratelimit.go" },
  { template: "add/auth/internal/app/user/model/user.go.hbs", output: "internal/app/user/model/user.go" },
  { template: "add/auth/internal/app/user/model/identity.go.hbs", output: "internal/app/user/model/identity.go" },
  { template: "add/auth/internal/app/user/model/loginthrottle.go.hbs", output: "internal/app/user/model/loginthrottle.go" },
  { template: "add/auth/internal/app/user/model/authtoken.go.hbs", output: "internal/app/user/model/authtoken.go" },
  { template: "add/auth/internal/app/user/model/mfa_enrollment.go.hbs", output: "internal/app/user/model/mfa_enrollment.go" },
  { template: "add/auth/internal/app/user/model/mfa_challenge.go.hbs", output: "internal/app/user/model/mfa_challenge.go" },
  { template: "add/auth/internal/app/user/model/mfa_recovery_code.go.hbs", output: "internal/app/user/model/mfa_recovery_code.go" },
  { template: "add/auth/internal/app/user/application/recovery.go.hbs", output: "internal/app/user/application/recovery.go" },
  { template: "add/auth/internal/app/user/application/oauth.go.hbs", output: "internal/app/user/application/oauth.go" },
  { template: "add/auth/internal/app/user/contracts.go.hbs", output: "internal/app/user/contracts.go" },
  { template: "add/auth/internal/app/user/composition.go.hbs", output: "internal/app/user/composition.go" },
  { template: "add/auth/internal/app/user/provider_test.go.hbs", output: "internal/app/user/provider_test.go" },
  { template: "add/auth/internal/app/user/handler_test.go.hbs", output: "internal/app/user/handler_test.go" },
  { template: "add/auth/internal/app/user/tokenstore_recovery.go.hbs", output: "internal/app/user/tokenstore_recovery.go" },
  { template: "add/auth/internal/app/user/dto.go.hbs", output: "internal/app/user/dto.go" },
  { template: "add/auth/internal/app/user/errors.go.hbs", output: "internal/app/user/errors.go" },
  { template: "add/auth/internal/app/user/jwt.go.hbs", output: "internal/app/user/jwt.go" },
  { template: "add/auth/internal/app/user/tokenstore.go.hbs", output: "internal/app/user/tokenstore.go" },
  { template: "add/auth/internal/app/user/mfa_store.go.hbs", output: "internal/app/user/mfa_store.go" },
  { template: "add/auth/internal/app/user/mfa_store_test.go.hbs", output: "internal/app/user/mfa_store_test.go" },
  { template: "add/auth/internal/app/user/mfa_service.go.hbs", output: "internal/app/user/mfa_service.go" },
  { template: "add/auth/internal/app/user/mfa_service_test.go.hbs", output: "internal/app/user/mfa_service_test.go" },
  { template: "add/auth/internal/app/user/repository.go.hbs", output: "internal/app/user/repository.go" },
  { template: "add/auth/internal/app/user/service.go.hbs", output: "internal/app/user/service.go" },
  { template: "add/auth/internal/app/user/local_auth.go.hbs", output: "internal/app/user/local_auth.go" },
  { template: "add/auth/internal/app/user/sessions.go.hbs", output: "internal/app/user/sessions.go" },
  { template: "add/auth/internal/app/user/recovery_service.go.hbs", output: "internal/app/user/recovery_service.go" },
  { template: "add/auth/internal/app/user/external_login.go.hbs", output: "internal/app/user/external_login.go" },
  { template: "add/auth/internal/app/user/user_query.go.hbs", output: "internal/app/user/user_query.go" },
  { template: "add/auth/internal/app/user/service_test.go.hbs", output: "internal/app/user/service_test.go" },
  { template: "add/auth/internal/app/user/repository_test.go.hbs", output: "internal/app/user/repository_test.go" },
  { template: "add/auth/internal/app/user/handler.go.hbs", output: "internal/app/user/handler.go" },
  { template: "add/auth/internal/app/user/handler_local.go.hbs", output: "internal/app/user/handler_local.go" },
  { template: "add/auth/internal/app/user/handler_recovery.go.hbs", output: "internal/app/user/handler_recovery.go" },
  { template: "add/auth/internal/app/user/handler_oauth.go.hbs", output: "internal/app/user/handler_oauth.go" },
  { template: "add/auth/internal/app/user/handler_user.go.hbs", output: "internal/app/user/handler_user.go" },
  { template: "add/auth/internal/app/user/handler_mfa.go.hbs", output: "internal/app/user/handler_mfa.go" },
  { template: "add/auth/internal/app/user/session_cookie.go.hbs", output: "internal/app/user/session_cookie.go" },
  { template: "add/auth/internal/app/user/browser_policy.go.hbs", output: "internal/app/user/browser_policy.go" },
  { template: "add/auth/internal/platform/authprovider/google/google.go.hbs", output: "internal/platform/authprovider/google/google.go" },
  { template: "add/auth/internal/platform/authprovider/google/google_test.go.hbs", output: "internal/platform/authprovider/google/google_test.go" },
  { template: "add/auth/cmd/seed/main.go.hbs", output: "cmd/seed/main.go" },
];

// Only the chosen store's implementation is written. Shipping both would drag
// go-redis into every project's go.mod for a file it never constructs — the
// same reason `add worker` writes one queue adapter, not two.
const POSTGRES: Entry[] = [
  { template: "add/auth/internal/app/user/tokenstore_pg.go.hbs", output: "internal/app/user/tokenstore_pg.go" },
  { template: "add/auth/internal/app/user/tokenstore_pg_test.go.hbs", output: "internal/app/user/tokenstore_pg_test.go" },
  { template: "add/auth/internal/shared/middleware/ratelimit_memory.go.hbs", output: "internal/shared/middleware/ratelimit_memory.go" },
];

const REDIS: Entry[] = [
  { template: "add/auth/internal/app/user/tokenstore_redis.go.hbs", output: "internal/app/user/tokenstore_redis.go" },
  { template: "add/auth/internal/app/user/tokenstore_redis_test.go.hbs", output: "internal/app/user/tokenstore_redis_test.go" },
  { template: "add/auth/internal/shared/middleware/ratelimit_redis.go.hbs", output: "internal/shared/middleware/ratelimit_redis.go" },
];

export function authFiles(store: AuthStore): Entry[] {
  return [...SHARED, ...(store === "postgres" ? POSTGRES : REDIS)];
}
