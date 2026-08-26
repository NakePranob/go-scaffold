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
  { template: "add/auth/internal/app/user/application/recovery.go.hbs", output: "internal/app/user/application/recovery.go" },
  { template: "add/auth/internal/app/user/composition.go.hbs", output: "internal/app/user/composition.go" },
  { template: "add/auth/internal/app/user/tokenstore_recovery.go.hbs", output: "internal/app/user/tokenstore_recovery.go" },
  { template: "add/auth/internal/app/user/dto.go.hbs", output: "internal/app/user/dto.go" },
  { template: "add/auth/internal/app/user/errors.go.hbs", output: "internal/app/user/errors.go" },
  { template: "add/auth/internal/app/user/jwt.go.hbs", output: "internal/app/user/jwt.go" },
  { template: "add/auth/internal/app/user/tokenstore.go.hbs", output: "internal/app/user/tokenstore.go" },
  { template: "add/auth/internal/app/user/repository.go.hbs", output: "internal/app/user/repository.go" },
  { template: "add/auth/internal/app/user/service.go.hbs", output: "internal/app/user/service.go" },
  { template: "add/auth/internal/app/user/service_test.go.hbs", output: "internal/app/user/service_test.go" },
  { template: "add/auth/internal/app/user/repository_test.go.hbs", output: "internal/app/user/repository_test.go" },
  { template: "add/auth/internal/app/user/handler.go.hbs", output: "internal/app/user/handler.go" },
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
