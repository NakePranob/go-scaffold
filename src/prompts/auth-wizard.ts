import { select } from "./interactive";
import { AuthStore } from "../types";

// The one decision `add auth` cannot make for you: where refresh tokens,
// one-time tokens and rate-limit counters live. It drives which tokenStore
// implementation is written, whether Redis is added to the project at all,
// and whether the auth_tokens table exists.
//
// Mirrors promptQueueBackend: the choice exists as `--store` for scripting,
// but nobody should have to know the flag name to discover the option.
export async function promptAuthStore(): Promise<AuthStore> {
  return select<AuthStore>({
    message: "Where should refresh tokens and rate-limit counters be stored?",
    default: "postgres",
    choices: [
      {
        name: "Postgres (user_svc.auth_tokens)",
        value: "postgres",
        description: "no extra service to run; tokens are rows in your own database, and the rate limiter counts in-process",
      },
      {
        name: "Redis",
        value: "redis",
        description: "TTL expiry and rate-limit counters are exact across replicas; needs a Redis server",
      },
    ],
  });
}
