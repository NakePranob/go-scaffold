import assert from "node:assert/strict";
import test from "node:test";

import { createSmokeRunConfig } from "../../dist/utils/smoke-run.js";

test("smoke runs receive isolated database, app port, database port, log namespace, and resource owner token", () => {
  const alpha = createSmokeRunConfig("alpha-101", 41001, 54101);
  const beta = createSmokeRunConfig("beta-202", 41002, 54102);

  assert.match(alpha.dbName, /^go_scaffold_smoke_alpha_101$/);
  assert.match(beta.dbName, /^go_scaffold_smoke_beta_202$/);
  assert.notEqual(alpha.dbName, beta.dbName);
  assert.equal(alpha.dbHost, "127.0.0.1");
  assert.equal(alpha.dbPort, 54101);
  assert.equal(beta.dbPort, 54102);
  assert.notEqual(alpha.dbPort, beta.dbPort);
  assert.match(alpha.dbDsn, /127\.0\.0\.1:54101\/go_scaffold_smoke_alpha_101\?sslmode=disable$/);

  assert.equal(alpha.port, 41001);
  assert.equal(beta.port, 41002);
  assert.notEqual(alpha.baseURL, beta.baseURL);
  assert.equal(alpha.baseURL, "http://127.0.0.1:41001");

  assert.notEqual(alpha.logPrefix, beta.logPrefix);
  assert.match(alpha.logPrefix, /go-scaffold-smoke-alpha_101$/);
  assert.equal(alpha.ownerToken, "go-scaffold-smoke-alpha_101");
  assert.equal(alpha.dockerLabel, "go-scaffold.smoke.owner=go-scaffold-smoke-alpha_101");
  assert.equal(alpha.containerNamePrefix, "go-scaffold-smoke-alpha_101");
  assert.notEqual(alpha.ownerToken, beta.ownerToken);
});

test("smoke config rejects invalid PostgreSQL ports", () => {
  assert.throws(() => createSmokeRunConfig("alpha", 41001, 0), /invalid smoke-test PostgreSQL port: 0/);
  assert.throws(() => createSmokeRunConfig("alpha", 41001, 65536), /invalid smoke-test PostgreSQL port: 65536/);
});
