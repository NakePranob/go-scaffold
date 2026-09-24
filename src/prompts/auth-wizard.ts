import { select } from "./interactive";
import { AsvsLevel, AuthStore, BrowserTopology } from "../types";

export const DEFAULT_ASVS_LEVEL: AsvsLevel = 2;

export function parseAsvsLevel(raw: string): AsvsLevel {
  const value = raw.trim();
  if (value !== "1" && value !== "2" && value !== "3") {
    throw new Error(`--asvs-level must be one of: 1, 2, 3 (got "${raw}")`);
  }
  return Number(value) as AsvsLevel;
}

export async function promptAsvsLevel(): Promise<AsvsLevel> {
  return select<AsvsLevel>({
    message: "Which OWASP ASVS 5.0.0 level should this project target for verification?",
    default: DEFAULT_ASVS_LEVEL,
    choices: [
      { name: "L1 — baseline", value: 1, description: "minimum security verification target" },
      { name: "L2 — most applications", value: 2, description: "includes L1; requires further auth controls and review" },
      { name: "L3 — high assurance", value: 3, description: "includes L1 and L2; requires phishing-resistant MFA and review" },
    ],
  });
}

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

export const DEFAULT_BROWSER_TOPOLOGY: BrowserTopology = "same-site";

const TOPOLOGIES: { name: string; value: BrowserTopology; description: string }[] = [
  {
    name: "Same-origin",
    value: "same-origin",
    description: "frontend and API share scheme, host, and port; simplest cookie boundary",
  },
  {
    name: "Same-site, different-origin",
    value: "same-site",
    description: "for example localhost:3000 + localhost:8080 or app.example.com + api.example.com",
  },
  {
    name: "Cross-site",
    value: "cross-site",
    description: "different registrable sites; requires SameSite=None, Secure cookies, HTTPS, and exact CORS",
  },
];

export function validateBrowserTopology(raw: string): BrowserTopology {
  const value = raw.trim().toLowerCase();
  if (!TOPOLOGIES.some((topology) => topology.value === value)) {
    throw new Error(
      `Browser topology must be one of: ${TOPOLOGIES.map((topology) => topology.value).join(", ")} (got "${raw}")`
    );
  }
  return value as BrowserTopology;
}

export async function promptBrowserTopology(): Promise<BrowserTopology> {
  return select<BrowserTopology>({
    message: "How are the browser frontend and API deployed?",
    default: DEFAULT_BROWSER_TOPOLOGY,
    choices: TOPOLOGIES,
  });
}
