import { select } from "./interactive";
import { AuthStore } from "../types";

// The one decision `add auth` cannot make for you: where refresh tokens and
// rate-limit counters live. Recovery tokens always use the durable Postgres
// table so consumption can share a transaction with the user update.
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
        description: "no extra service to run; refresh and recovery tokens use your database, and the rate limiter counts in-process",
      },
      {
        name: "Redis",
        value: "redis",
        description: "refresh TTL and rate-limit counters are exact across replicas; recovery stays transactional in Postgres; needs Redis",
      },
    ],
  });
}
