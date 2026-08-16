export interface SmokeRunConfig {
  readonly runID: string;
  readonly dbName: string;
  readonly dbHost: string;
  readonly dbPort: number;
  readonly dbDsn: string;
  readonly port: number;
  readonly baseURL: string;
  readonly logPrefix: string;
  readonly ownerToken: string;
  readonly dockerLabel: string;
  readonly containerNamePrefix: string;
}

const POSTGRES_HOST = "127.0.0.1";

function assertPort(port: number, label: string): void {
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`invalid smoke-test ${label}: ${port}`);
  }
}

export function createSmokeRunConfig(runID: string, port: number, dbPort = 5432): SmokeRunConfig {
  assertPort(port, "port");
  assertPort(dbPort, "PostgreSQL port");

  const normalizedRunID = runID.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  if (!normalizedRunID) {
    throw new Error("smoke-test run ID must contain at least one letter or digit");
  }

  const dbName = `go_scaffold_smoke_${normalizedRunID}`;
  return {
    runID: normalizedRunID,
    dbName,
    dbHost: POSTGRES_HOST,
    dbPort,
    dbDsn: `postgres://postgres:postgres@${POSTGRES_HOST}:${dbPort}/${dbName}?sslmode=disable`,
    port,
    baseURL: `http://127.0.0.1:${port}`,
    logPrefix: `go-scaffold-smoke-${normalizedRunID}`,
    ownerToken: `go-scaffold-smoke-${normalizedRunID}`,
    dockerLabel: `go-scaffold.smoke.owner=go-scaffold-smoke-${normalizedRunID}`,
    containerNamePrefix: `go-scaffold-smoke-${normalizedRunID}`,
  };
}
