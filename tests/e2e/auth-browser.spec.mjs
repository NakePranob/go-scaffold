import { expect, test } from "@playwright/test";
import { createHash } from "node:crypto";
import { createAuthHarness } from "./fixtures/auth-harness.mjs";

let harness;

function assertCondition(condition, message) {
  if (!condition) throw new Error(message);
}

test.beforeAll(async () => {
  harness = await createAuthHarness();
});

test.afterAll(async () => {
  await harness?.close();
});

async function openFixture(page, apiUrl = harness.sameApiUrl, topology = "same-site", origin = harness.frontendOrigin) {
  const query = new URLSearchParams({ api: apiUrl, topology });
  await page.goto(`${origin}/?${query}`);
  await expect(page.getByTestId("status")).toHaveText("idle");
}

async function cleanCallback(page) {
  await expect.poll(() => {
    const current = new URL(page.url());
    return current.origin === harness.frontendOrigin && current.pathname === "/oauth/callback/google" && !current.search && !current.hash;
  }).toBe(true);
}

test("Google success uses client-owned callback, memory access state, and safe cookie/token headers", async ({ page, context }) => {
  await openFixture(page);

  let loginRequest;
  let exchangePayload;
  page.on("request", (request) => {
    if (request.url().includes("/auth/google/login")) loginRequest = new URL(request.url());
    if (request.url().includes("/auth/google/exchange")) exchangePayload = request.postDataJSON();
  });

  await page.getByTestId("google-success").click();
  await cleanCallback(page);
  await expect(page.getByTestId("status")).toHaveText("authenticated");
  await expect(page.getByTestId("message")).toHaveText("Google sign-in complete.");

  const cookies = await context.cookies([harness.sameApiUrl]);
  expect(cookies).toHaveLength(1);
  expect(cookies[0].httpOnly).toBe(true);
  expect(cookies[0].sameSite).toBe("Strict");
  expect(cookies[0].secure).toBe(false);

  const headers = await page.evaluate(() => window.__e2e.getLastTokenHeaders());
  expect(headers).toEqual({ cacheControl: "no-store", pragma: "no-cache" });
  const browserConfig = await page.evaluate(() => window.__e2e.config());
  expect(browserConfig.topology).toBe("same-site");

  expect(loginRequest).toBeTruthy();
  const state = loginRequest.searchParams.get("state");
  const challenge = loginRequest.searchParams.get("code_challenge");
  expect(Buffer.from(state, "base64url").length).toBeGreaterThanOrEqual(16);
  assertCondition(/^[A-Za-z0-9_-]+$/.test(state), "frontend state contains a disallowed character");
  assertCondition(/^[A-Za-z0-9_-]{43}$/.test(challenge), "frontend code challenge is not a base64url SHA-256 value");
  expect(loginRequest.searchParams.get("code_challenge_method")).toBe("S256");
  assertCondition(/^[A-Za-z0-9\-._~]{43,128}$/.test(exchangePayload.code_verifier), "frontend verifier is outside the RFC 7636 unreserved range");
  assertCondition(!/\s/.test(exchangePayload.code_verifier), "frontend verifier contains whitespace");
  assertCondition(createHash("sha256").update(exchangePayload.code_verifier).digest("base64url") === challenge, "frontend verifier does not match the S256 challenge");
});

test("provider cancel/error become controlled local messages and never echo provider details", async ({ page }) => {
  await openFixture(page);

  await page.getByTestId("google-cancel").click();
  await cleanCallback(page);
  await expect(page.getByTestId("status")).toHaveText("error");
  await expect(page.getByTestId("error-code")).toHaveText("oauth_denied");
  await expect(page.getByTestId("message")).toHaveText("The provider sign-in was cancelled.");
  await expect(page.locator("body")).not.toContainText("provider-internal-detail");

  await page.goto(`${harness.frontendOrigin}/?api=${encodeURIComponent(harness.sameApiUrl)}&topology=same-site`);
  await page.getByTestId("google-provider-error").click();
  await cleanCallback(page);
  await expect(page.getByTestId("error-code")).toHaveText("oauth_failed");
  await expect(page.locator("body")).not.toContainText("upstream-secret-like-detail");

  await page.goto(`${harness.frontendOrigin}/?api=${encodeURIComponent(harness.sameApiUrl)}&topology=same-site`);
  await page.getByTestId("google-unavailable").click();
  await cleanCallback(page);
  await expect(page.getByTestId("error-code")).toHaveText("oauth_provider_unavailable");
});

test("missing, mismatched, expired, replayed state and wrong verifier fail closed", async ({ page }) => {
  await openFixture(page);

  await page.goto(`${harness.frontendOrigin}${"/oauth/callback/google"}?api=${encodeURIComponent(harness.sameApiUrl)}&code=unbound-code`);
  await cleanCallback(page);
  await expect(page.getByTestId("error-code")).toHaveText("oauth_state_invalid");

  await page.goto(`${harness.frontendOrigin}${"/oauth/callback/google"}?api=${encodeURIComponent(harness.sameApiUrl)}&error=access_denied&error_description=must-not-be-trusted`);
  await cleanCallback(page);
  await expect(page.getByTestId("error-code")).toHaveText("oauth_state_invalid");

  await page.goto(`${harness.frontendOrigin}${"/oauth/callback/google"}?api=${encodeURIComponent(harness.sameApiUrl)}&code=unbound-code&state=AAAAAAAAAAAAAAAAAAAAAA`);
  await cleanCallback(page);
  await expect(page.getByTestId("error-code")).toHaveText("oauth_state_invalid");

  await page.goto(`${harness.frontendOrigin}/?api=${encodeURIComponent(harness.sameApiUrl)}&topology=same-site`);
  await page.getByTestId("google-expired").click();
  await cleanCallback(page);
  await expect(page.getByTestId("error-code")).toHaveText("oauth_state_invalid");

  await page.goto(`${harness.frontendOrigin}/?api=${encodeURIComponent(harness.sameApiUrl)}&topology=same-site`);
  await page.getByTestId("google-wrong-verifier").click();
  await cleanCallback(page);
  await expect(page.getByTestId("error-code")).toHaveText("oauth_state_invalid");

  await page.goto(`${harness.frontendOrigin}/?api=${encodeURIComponent(harness.sameApiUrl)}&topology=same-site`);
  await page.getByTestId("google-success").click();
  await cleanCallback(page);
  await expect(page.getByTestId("status")).toHaveText("authenticated");
  expect(await page.evaluate(() => window.__e2e.replayLast())).toBe(true);
  await expect(page.getByTestId("error-code")).toHaveText("oauth_state_invalid");
  await cleanCallback(page);
});

test("each browser tab owns its OAuth transaction independently", async ({ page, context }) => {
  const secondTab = await context.newPage();
  try {
    await Promise.all([openFixture(page), openFixture(secondTab)]);
    await Promise.all([page.getByTestId("google-success").click(), secondTab.getByTestId("google-success").click()]);
    await Promise.all([cleanCallback(page), cleanCallback(secondTab)]);
    await Promise.all([
      expect(page.getByTestId("status")).toHaveText("authenticated"),
      expect(secondTab.getByTestId("status")).toHaveText("authenticated"),
    ]);
  } finally {
    await secondTab.close();
  }
});

test("exact CORS origins allow the configured frontend and reject an alias origin", async ({ page }) => {
  await openFixture(page);
  const allowed = await page.evaluate((url) => window.__e2e.corsProbe(url), harness.sameApiUrl);
  expect(allowed).toEqual({ ok: true, allowOrigin: harness.frontendOrigin });

  const alias = await page.context().newPage();
  try {
    await openFixture(alias, harness.sameApiUrl, "same-site", harness.frontendAliasOrigin);
    const disallowed = await alias.evaluate((url) => window.__e2e.corsProbe(url), harness.sameApiUrl);
    expect(disallowed).toEqual({ ok: false, corsBlocked: true });
  } finally {
    await alias.close();
  }
});

test("cross-site mode requires None + Secure and keeps the API origin guard", async ({ page, context, request }) => {
  await openFixture(page, harness.crossApiUrl, "cross-site");
  await page.getByTestId("google-success").click();
  await cleanCallback(page);
  await expect(page.getByTestId("status")).toHaveText("authenticated");

  const cookies = await context.cookies([harness.crossApiUrl]);
  expect(cookies).toHaveLength(1);
  expect(cookies[0].httpOnly).toBe(true);
  expect(cookies[0].sameSite).toBe("None");
  expect(cookies[0].secure).toBe(true);

  const forbidden = await request.post(`${harness.crossApiUrl}/auth/refresh`, {
    headers: { Origin: "https://evil.example.test", "Content-Type": "application/json" },
    data: {},
    ignoreHTTPSErrors: true,
  });
  expect(forbidden.status()).toBe(403);
  expect((await forbidden.json()).code).toBe("CSRF_ORIGIN_INVALID");
});

test("unconfigured provider and arbitrary return_to never create a redirect contract", async ({ page, request }) => {
  await openFixture(page);
  const state = "A".repeat(43);
  const challenge = "B".repeat(43);
  const unavailable = await request.get(`${harness.sameApiUrl}/auth/github/login?state=${state}&code_challenge=${challenge}&code_challenge_method=S256`, {
    headers: { Origin: harness.frontendOrigin },
    maxRedirects: 0,
  });
  expect(unavailable.status()).toBe(503);
  expect((await unavailable.json()).code).toBe("oauth_provider_unavailable");
  expect(unavailable.headers().location).toBeUndefined();

  const login = await request.get(`${harness.sameApiUrl}/auth/google/login?state=${state}&code_challenge=${challenge}&code_challenge_method=S256&return_to=https%3A%2F%2Fevil.example.test`, {
    headers: { Origin: harness.frontendOrigin },
    maxRedirects: 0,
  });
  expect(login.status()).toBe(302);
  const location = login.headers().location;
  expect(location).toBeTruthy();
  assertCondition(!location.includes("return_to"), "provider redirect propagated an arbitrary return_to");
  expect(new URL(location).searchParams.get("redirect_uri")).toBe(harness.callbackUri);
  assertCondition(!/access_token|refresh_token|authorization_code/.test(location), "provider redirect contained token or authorization-code material");

  const whitespaceState = await request.get(`${harness.sameApiUrl}/auth/google/login?state=${encodeURIComponent(`${state} `)}&code_challenge=${challenge}&code_challenge_method=S256`, {
    headers: { Origin: harness.frontendOrigin },
  });
  expect(whitespaceState.status()).toBe(400);
  expect((await whitespaceState.json()).code).toBe("oauth_state_invalid");
});

test("email register/login/refresh/logout regression keeps session material out of the URL", async ({ page, context }) => {
  await openFixture(page);
  const identity = `browser-${Date.now()}@example.test`;
  const password = "fixture-password";

  expect(await page.evaluate(({ identity, password }) => window.__e2e.emailRegister(identity, password), { identity, password })).toMatchObject({ ok: true, status: 200 });
  const current = new URL(page.url());
  if (/(?:code|state|access_token|refresh_token)=/.test(current.search)) {
    throw new Error("email flow put session material in the browser URL");
  }
  const beforeRefresh = await context.cookies([harness.sameApiUrl]);
  expect(beforeRefresh[0].httpOnly).toBe(true);

  expect(await page.evaluate(({ identity, password }) => window.__e2e.emailLogout(), { identity, password })).toMatchObject({ ok: true, status: 204 });
  expect(await page.evaluate(({ identity, password }) => window.__e2e.emailLogin(identity, password), { identity, password })).toMatchObject({ ok: true, status: 200 });
  expect(await page.evaluate(() => window.__e2e.emailRefresh())).toMatchObject({ ok: true, status: 200 });
  const afterRefresh = await context.cookies([harness.sameApiUrl]);
  expect(afterRefresh[0].httpOnly).toBe(true);
  assertCondition(afterRefresh[0].value !== beforeRefresh[0].value, "refresh did not rotate the HttpOnly cookie");

  expect(await page.evaluate(() => window.__e2e.emailLogout())).toMatchObject({ ok: true, status: 204 });
  await expect(page.getByTestId("status")).toHaveText("logged-out");
});
