(() => {
  "use strict";

  const CALLBACK_PATH = "/oauth/callback/google";
  const STATE_BYTES = 32;
  const VERIFIER_LENGTH = 64;
  const STORAGE_PREFIX = "oauth:google:";
  const VERIFIER_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~";
  const ERROR_MESSAGES = Object.freeze({
    oauth_denied: "The provider sign-in was cancelled.",
    oauth_state_invalid: "This sign-in expired or was not valid.",
    oauth_provider_unavailable: "The provider is temporarily unavailable.",
    oauth_failed: "The provider sign-in could not be completed.",
  });

  const initialUrl = new URL(window.location.href);
  const configuredApi = initialUrl.searchParams.get("api") || sessionStorage.getItem("e2e:api");
  const configuredTopology = initialUrl.searchParams.get("topology") || sessionStorage.getItem("e2e:topology") || "same-site";
  if (configuredApi) sessionStorage.setItem("e2e:api", configuredApi);
  sessionStorage.setItem("e2e:topology", configuredTopology);

  let accessToken = null;
  let lastCallback = null;
  let lastTokenHeaders = { cacheControl: "", pragma: "" };

  const apiBase = () => sessionStorage.getItem("e2e:api") || configuredApi || "";

  function status(value, message = "", errorCode = "") {
    document.querySelector('[data-testid="status"]').textContent = value;
    document.querySelector('[data-testid="message"]').textContent = message;
    document.querySelector('[data-testid="error-code"]').textContent = errorCode;
  }

  function randomBytes(size) {
    const bytes = new Uint8Array(size);
    crypto.getRandomValues(bytes);
    return bytes;
  }

  function base64Url(bytes) {
    let binary = "";
    for (const byte of bytes) binary += String.fromCharCode(byte);
    return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
  }

  function randomState() {
    return base64Url(randomBytes(STATE_BYTES));
  }

  function randomVerifier() {
    let value = "";
    const limit = Math.floor(256 / VERIFIER_ALPHABET.length) * VERIFIER_ALPHABET.length;
    while (value.length < VERIFIER_LENGTH) {
      for (const byte of randomBytes(VERIFIER_LENGTH)) {
        if (byte >= limit) continue;
        value += VERIFIER_ALPHABET[byte % VERIFIER_ALPHABET.length];
        if (value.length === VERIFIER_LENGTH) break;
      }
    }
    return value;
  }

  async function challengeFor(verifier) {
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
    return base64Url(new Uint8Array(digest));
  }

  function transactionKey(state) {
    return `${STORAGE_PREFIX}${state}`;
  }

  function readTransaction(state) {
    if (!state) return null;
    const raw = sessionStorage.getItem(transactionKey(state));
    if (!raw) return null;
    try {
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }

  async function beginOAuth(scenario = "success") {
    const state = randomState();
    const verifier = randomVerifier();
    const challenge = await challengeFor(verifier);
    sessionStorage.setItem(transactionKey(state), JSON.stringify({ state, verifier, scenario }));
    const query = new URLSearchParams({
      state,
      code_challenge: challenge,
      code_challenge_method: "S256",
      // The selector is accepted only by the isolated fake API fixture.
      test_scenario: scenario,
    });
    window.location.assign(`${apiBase()}/auth/google/login?${query.toString()}`);
  }

  function scrubCallbackUrl() {
    window.history.replaceState(null, "", CALLBACK_PATH);
  }

  async function responseJson(response) {
    let body = {};
    try {
      body = await response.json();
    } catch {
      body = {};
    }
    return { response, body };
  }

  async function exchange(payload) {
    const response = await fetch(`${apiBase()}/auth/google/exchange`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const result = await responseJson(response);
    if (result.body && result.body.access_token) {
      lastTokenHeaders = {
        cacheControl: response.headers.get("cache-control") || "",
        pragma: response.headers.get("pragma") || "",
      };
    }
    if (!response.ok) {
      const code = result.body.code || "oauth_failed";
      status("error", ERROR_MESSAGES[code] || ERROR_MESSAGES.oauth_failed, code);
      return false;
    }
    accessToken = result.body.access_token;
    const me = await fetch(`${apiBase()}/users/me`, {
      headers: { Authorization: `Bearer ${accessToken}` },
      credentials: "include",
    });
    if (!me.ok) {
      accessToken = null;
      status("error", ERROR_MESSAGES.oauth_failed, "oauth_failed");
      return false;
    }
    status("authenticated", "Google sign-in complete.");
    return true;
  }

  async function handleCallback() {
    if (window.location.pathname !== CALLBACK_PATH) return;
    const callback = new URL(window.location.href);
    const code = callback.searchParams.get("code");
    const state = callback.searchParams.get("state");
    const providerError = callback.searchParams.get("error");
    const transaction = readTransaction(state);
    scrubCallbackUrl();

    if (state) sessionStorage.removeItem(transactionKey(state));
    if (providerError) {
      if (!state || !transaction || transaction.state !== state) {
        status("error", ERROR_MESSAGES.oauth_state_invalid, "oauth_state_invalid");
        return;
      }
      const errorCode = providerError === "access_denied" ? "oauth_denied" : "oauth_failed";
      status("error", ERROR_MESSAGES[errorCode], errorCode);
      return;
    }
    if (!code || !state || !transaction || transaction.state !== state) {
      status("error", ERROR_MESSAGES.oauth_state_invalid, "oauth_state_invalid");
      return;
    }

    const verifier = transaction.scenario === "wrong-verifier" ? `${transaction.verifier} ` : transaction.verifier;
    lastCallback = { code, state, verifier: transaction.verifier };
    await exchange({ code, state, code_verifier: verifier });
  }

  async function emailRequest(path, payload) {
    const response = await fetch(`${apiBase()}${path}`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const result = await responseJson(response);
    if (result.body && result.body.access_token) {
      accessToken = result.body.access_token;
      lastTokenHeaders = {
        cacheControl: response.headers.get("cache-control") || "",
        pragma: response.headers.get("pragma") || "",
      };
    }
    return result;
  }

  async function emailRegister(email, password, name = "Browser Fixture") {
    const result = await emailRequest("/auth/register", { email, password, name });
    if (result.response.ok) status("authenticated", "Email registration complete.");
    else status("error", "Email registration failed.", result.body.code || "AUTH_INVALID_INPUT");
    return { ok: result.response.ok, status: result.response.status, code: result.body.code || "" };
  }

  async function emailLogin(email, password) {
    const result = await emailRequest("/auth/login", { email, password });
    if (result.response.ok) status("authenticated", "Email login complete.");
    else status("error", "Email login failed.", result.body.code || "AUTH_INVALID_CREDENTIALS");
    return { ok: result.response.ok, status: result.response.status, code: result.body.code || "" };
  }

  async function emailRefresh() {
    const result = await emailRequest("/auth/refresh", {});
    if (result.response.ok) status("authenticated", "Session refreshed.");
    else status("error", "Session refresh failed.", result.body.code || "AUTH_INVALID_TOKEN");
    return { ok: result.response.ok, status: result.response.status, code: result.body.code || "" };
  }

  async function emailLogout() {
    const response = await fetch(`${apiBase()}/auth/logout`, { method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: "{}" });
    accessToken = null;
    status(response.ok ? "logged-out" : "error", response.ok ? "Email logout complete." : "Email logout failed.", response.ok ? "" : "AUTH_INVALID_TOKEN");
    return { ok: response.ok, status: response.status };
  }

  async function corsProbe(url) {
    try {
      const response = await fetch(`${url}/livez`, { credentials: "include" });
      return { ok: response.ok, allowOrigin: response.headers.get("access-control-allow-origin") || "" };
    } catch {
      return { ok: false, corsBlocked: true };
    }
  }

  function getLastTokenHeaders() {
    return { ...lastTokenHeaders };
  }

  window.__e2e = Object.freeze({
    beginOAuth,
    replayLast: async () => {
      if (!lastCallback) return false;
      await exchange(lastCallback);
      return true;
    },
    emailRegister,
    emailLogin,
    emailRefresh,
    emailLogout,
    corsProbe,
    getLastTokenHeaders,
    config: () => ({ apiBase: apiBase(), topology: sessionStorage.getItem("e2e:topology") || "" }),
  });

  document.querySelector('[data-testid="google-success"]').addEventListener("click", () => beginOAuth("success"));
  document.querySelector('[data-testid="google-cancel"]').addEventListener("click", () => beginOAuth("cancel"));
  document.querySelector('[data-testid="google-provider-error"]').addEventListener("click", () => beginOAuth("provider-error"));
  document.querySelector('[data-testid="google-unavailable"]').addEventListener("click", () => beginOAuth("provider-unavailable"));
  document.querySelector('[data-testid="google-expired"]').addEventListener("click", () => beginOAuth("expired"));
  document.querySelector('[data-testid="google-wrong-verifier"]').addEventListener("click", () => beginOAuth("wrong-verifier"));

  const email = () => document.querySelector('[data-testid="email"]').value;
  const password = () => document.querySelector('[data-testid="password"]').value;
  document.querySelector('[data-testid="email-register"]').addEventListener("click", () => emailRegister(email(), password()));
  document.querySelector('[data-testid="email-login"]').addEventListener("click", () => emailLogin(email(), password()));
  document.querySelector('[data-testid="email-refresh"]').addEventListener("click", emailRefresh);
  document.querySelector('[data-testid="email-logout"]').addEventListener("click", emailLogout);

  handleCallback();
})();
