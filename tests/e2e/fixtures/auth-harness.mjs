import { createHash, randomBytes } from "node:crypto";
import { execFileSync } from "node:child_process";
import { createReadStream, existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createServer as createHttpServer } from "node:http";
import { createServer as createHttpsServer } from "node:https";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FRONTEND_ROOT = path.join(HERE, "frontend");
const STATE_RE = /^[A-Za-z0-9_-]+$/;
const VERIFIER_RE = /^[A-Za-z0-9\-._~]{43,128}$/;
const CHALLENGE_RE = /^[A-Za-z0-9_-]{43}$/;
const CALLBACK_PATH = "/oauth/callback/google";

export const OAUTH_CODES = Object.freeze({
  denied: "oauth_denied",
  stateInvalid: "oauth_state_invalid",
  unavailable: "oauth_provider_unavailable",
  failed: "oauth_failed",
});

const PUBLIC_MESSAGES = Object.freeze({
  [OAUTH_CODES.denied]: "external login was denied",
  [OAUTH_CODES.stateInvalid]: "oauth state or PKCE verifier is invalid",
  [OAUTH_CODES.unavailable]: "external login provider is unavailable",
  [OAUTH_CODES.failed]: "external login failed",
});

function base64Url(bytes) {
  return Buffer.from(bytes).toString("base64url");
}

function randomToken(bytes = 32) {
  return base64Url(randomBytes(bytes));
}

function hash(value) {
  return createHash("sha256").update(value).digest("hex");
}

function pkceChallenge(verifier) {
  return createHash("sha256").update(verifier).digest("base64url");
}

function validState(value) {
  if (typeof value !== "string" || value.length < 22 || !STATE_RE.test(value)) return false;
  try {
    return Buffer.from(value, "base64url").length >= 16;
  } catch {
    return false;
  }
}

function validVerifier(value) {
  return typeof value === "string" && VERIFIER_RE.test(value);
}

function validChallenge(value) {
  return typeof value === "string" && CHALLENGE_RE.test(value);
}

function sameString(left, right) {
  return typeof left === "string" && typeof right === "string" && left === right;
}

function parseCookies(request) {
  const cookies = new Map();
  for (const part of String(request.headers.cookie ?? "").split(";")) {
    const index = part.indexOf("=");
    if (index < 0) continue;
    const name = part.slice(0, index).trim();
    const value = part.slice(index + 1).trim();
    if (name) cookies.set(name, decodeURIComponent(value));
  }
  return cookies;
}

async function readJson(request) {
  let body = "";
  for await (const chunk of request) {
    body += chunk;
    if (body.length > 32 * 1024) throw new Error("request body too large");
  }
  if (!body) return {};
  return JSON.parse(body);
}

function sendJson(response, status, payload, headers = {}) {
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    ...headers,
  });
  response.end(JSON.stringify(payload));
}

function sendControlledError(response, status, code) {
  sendJson(response, status, { code, message: PUBLIC_MESSAGES[code] ?? PUBLIC_MESSAGES[OAUTH_CODES.failed] });
}

function sendNoContent(response, headers = {}) {
  response.writeHead(204, headers);
  response.end();
}

function exactOrigin(value, allowedOrigins) {
  return typeof value === "string" && allowedOrigins.includes(value);
}

function setCors(response, request, allowedOrigins) {
  const origin = request.headers.origin;
  if (!origin) return false;
  if (!exactOrigin(origin, allowedOrigins)) return false;
  response.setHeader("Access-Control-Allow-Origin", origin);
  response.setHeader("Access-Control-Allow-Credentials", "true");
  response.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  response.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  response.setHeader("Access-Control-Expose-Headers", "Location, Cache-Control, Pragma, Access-Control-Allow-Origin");
  response.setHeader("Vary", "Origin");
  return true;
}

function setNoStore(response) {
  response.setHeader("Cache-Control", "no-store");
  response.setHeader("Pragma", "no-cache");
}

function cookieHeader(value, { secure, sameSite, maxAge }) {
  const attributes = [
    `refresh_token=${encodeURIComponent(value)}`,
    `Max-Age=${maxAge}`,
    "Path=/",
    "HttpOnly",
    `SameSite=${sameSite}`,
  ];
  if (secure) attributes.push("Secure");
  return attributes.join("; ");
}

function localUser(email, password, name, id = randomToken(16)) {
  return { id, email, password, name, provider: "local" };
}

export class FakeOidcProvider {
  #baseUrl = "";
  #callbackUri;
  #clientId;
  #codes = new Map();

  constructor({ callbackUri, clientId = "fake-oidc-client" }) {
    this.#callbackUri = callbackUri;
    this.#clientId = clientId;
  }

  setBaseUrl(baseUrl) {
    this.#baseUrl = baseUrl;
  }

  get callbackUri() {
    return this.#callbackUri;
  }

  get clientId() {
    return this.#clientId;
  }

  begin({ state, codeChallenge, codeChallengeMethod, nonce, scenario = "success" }) {
    if (!this.#baseUrl || !validState(state) || !validChallenge(codeChallenge) || codeChallengeMethod !== "S256" || !nonce) {
      throw new ProviderFault(OAUTH_CODES.failed);
    }
    const query = new URLSearchParams({
      response_type: "code",
      client_id: this.#clientId,
      redirect_uri: this.#callbackUri,
      scope: "openid email profile",
      state,
      code_challenge: codeChallenge,
      code_challenge_method: codeChallengeMethod,
      nonce,
      // This is intentionally a test-only input. Production providers never
      // receive scenario selectors from the application browser.
      test_scenario: scenario,
    });
    return `${this.#baseUrl}/authorize?${query}`;
  }

  async handleAuthorize(request, response) {
    const url = new URL(request.url, this.#baseUrl);
    const state = url.searchParams.get("state");
    const redirectUri = url.searchParams.get("redirect_uri");
    const challenge = url.searchParams.get("code_challenge");
    const method = url.searchParams.get("code_challenge_method");
    const nonce = url.searchParams.get("nonce");
    const scenario = url.searchParams.get("test_scenario") || "success";

    if (
      redirectUri !== this.#callbackUri ||
      url.searchParams.get("response_type") !== "code" ||
      url.searchParams.get("client_id") !== this.#clientId ||
      url.searchParams.get("scope") !== "openid email profile" ||
      !validState(state) ||
      !validChallenge(challenge) ||
      method !== "S256" ||
      !nonce
    ) {
      response.writeHead(400, { "Content-Type": "text/plain; charset=utf-8" });
      response.end("invalid fake OIDC authorization request");
      return;
    }

    const callback = new URL(this.#callbackUri);
    callback.searchParams.set("state", state);
    if (scenario === "cancel") {
      callback.searchParams.set("error", "access_denied");
      callback.searchParams.set("error_description", "provider-internal-detail");
      response.writeHead(302, { Location: callback.toString() });
      response.end();
      return;
    }
    if (scenario === "provider-error") {
      callback.searchParams.set("error", "server_error");
      callback.searchParams.set("error_description", "upstream-secret-like-detail");
      response.writeHead(302, { Location: callback.toString() });
      response.end();
      return;
    }

    const code = randomToken(24);
    this.#codes.set(code, {
      codeChallenge: challenge,
      nonce,
      scenario,
      subject: "fake-subject-1",
      email: "oidc.user@example.test",
      name: "Fake OIDC User",
    });
    callback.searchParams.set("code", code);
    response.writeHead(302, { Location: callback.toString() });
    response.end();
  }

  async complete({ code, codeVerifier, nonce }) {
    const transaction = this.#codes.get(code);
    if (!transaction) throw new ProviderFault(OAUTH_CODES.failed);
    this.#codes.delete(code);

    if (transaction.scenario === "provider-unavailable") throw new ProviderFault(OAUTH_CODES.unavailable);
    if (!validVerifier(codeVerifier) || pkceChallenge(codeVerifier) !== transaction.codeChallenge) {
      throw new ProviderFault(OAUTH_CODES.stateInvalid);
    }
    if (!sameString(nonce, transaction.nonce)) throw new ProviderFault(OAUTH_CODES.failed);

    return {
      provider: "google",
      subject: transaction.subject,
      email: transaction.email,
      emailVerified: true,
      name: transaction.name,
    };
  }

  async handle(request, response) {
    if (request.method !== "GET" || new URL(request.url, this.#baseUrl).pathname !== "/authorize") {
      response.writeHead(404);
      response.end();
      return;
    }
    await this.handleAuthorize(request, response);
  }
}

export class ProviderFault extends Error {
  constructor(code) {
    super(code);
    this.name = "ProviderFault";
    this.code = code;
  }
}

export class FakeAuthApi {
  #providers;
  #callbackUri;
  #allowedOrigins;
  #topology;
  #secure;
  #sameSite;
  #transactions = new Map();
  #users = new Map();
  #accessTokens = new Map();
  #refreshTokens = new Map();

  constructor({ providers, frontendOrigin, callbackUri, allowedOrigins = [frontendOrigin], topology = "same-site", secure = false, sameSite = "Strict" }) {
    this.#providers = providers;
    this.#callbackUri = callbackUri;
    this.#allowedOrigins = [...allowedOrigins];
    this.#topology = topology;
    this.#secure = secure;
    this.#sameSite = sameSite;
    if (topology === "cross-site" && (!secure || sameSite.toLowerCase() !== "none")) {
      throw new Error("cross-site fake API requires SameSite=None and Secure");
    }
  }

  get cookiePolicy() {
    return { topology: this.#topology, secure: this.#secure, sameSite: this.#sameSite };
  }

  #issueSession(response, user) {
    const accessToken = randomToken(32);
    const refreshToken = randomToken(32);
    this.#accessTokens.set(accessToken, user.id);
    this.#refreshTokens.set(refreshToken, { userId: user.id, expiresAt: Date.now() + 60 * 60 * 1000 });
    setNoStore(response);
    response.setHeader("Set-Cookie", cookieHeader(refreshToken, { secure: this.#secure, sameSite: this.#sameSite, maxAge: 3600 }));
    sendJson(response, 200, { access_token: accessToken, token_type: "Bearer", expires_in: 900 });
  }

  #findOrCreateOidcUser(identity) {
    const key = `${identity.provider}:${identity.subject}`;
    for (const user of this.#users.values()) {
      if (user.provider === key) return user;
    }
    const user = localUser(identity.email, "", identity.name);
    user.provider = key;
    this.#users.set(user.email, user);
    return user;
  }

  #bearerUser(request) {
    const header = String(request.headers.authorization ?? "");
    if (!header.startsWith("Bearer ")) return null;
    const userId = this.#accessTokens.get(header.slice("Bearer ".length));
    if (!userId) return null;
    return [...this.#users.values()].find((user) => user.id === userId) ?? null;
  }

  async #providerLogin(request, response, providerName) {
    const provider = this.#providers.get(providerName);
    if (!provider) {
      sendControlledError(response, 503, OAUTH_CODES.unavailable);
      return;
    }
    const url = new URL(request.url, "http://fake-api.invalid");
    const state = url.searchParams.get("state");
    const challenge = url.searchParams.get("code_challenge");
    const method = url.searchParams.get("code_challenge_method");
    if (!validState(state) || !validChallenge(challenge) || method !== "S256") {
      sendControlledError(response, 400, OAUTH_CODES.stateInvalid);
      return;
    }

    const nonce = randomToken(24);
    const scenario = url.searchParams.get("test_scenario") || "success";
    let location;
    try {
      location = provider.begin({ state, codeChallenge: challenge, codeChallengeMethod: method, nonce, scenario });
    } catch {
      sendControlledError(response, 503, OAUTH_CODES.unavailable);
      return;
    }
    if (!location) {
      sendControlledError(response, 503, OAUTH_CODES.unavailable);
      return;
    }
    this.#transactions.set(hash(state), {
      provider: providerName,
      codeChallenge: challenge,
      nonce,
      expiresAt: scenario === "expired" ? Date.now() - 1 : Date.now() + 10 * 60 * 1000,
    });
    response.setHeader("Cache-Control", "no-store");
    response.setHeader("Location", location);
    response.writeHead(302);
    response.end();
  }

  async #providerExchange(request, response, providerName) {
    setNoStore(response);
    let body;
    try {
      body = await readJson(request);
    } catch {
      sendControlledError(response, 400, OAUTH_CODES.failed);
      return;
    }
    const code = body.code;
    const state = body.state;
    const verifier = body.code_verifier;
    if (!validState(state) || !validVerifier(verifier)) {
      sendControlledError(response, 400, OAUTH_CODES.stateInvalid);
      return;
    }
    if (typeof code !== "string" || code.length === 0) {
      sendControlledError(response, 400, OAUTH_CODES.failed);
      return;
    }
    const transactionKey = hash(state);
    const transaction = this.#transactions.get(transactionKey);
    this.#transactions.delete(transactionKey);
    if (!transaction || transaction.provider !== providerName || transaction.expiresAt <= Date.now()) {
      sendControlledError(response, 400, OAUTH_CODES.stateInvalid);
      return;
    }
    if (pkceChallenge(verifier) !== transaction.codeChallenge) {
      sendControlledError(response, 400, OAUTH_CODES.stateInvalid);
      return;
    }

    const provider = this.#providers.get(providerName);
    if (!provider) {
      sendControlledError(response, 503, OAUTH_CODES.unavailable);
      return;
    }
    let identity;
    try {
      identity = await provider.complete({ code, codeVerifier: verifier, nonce: transaction.nonce });
    } catch (error) {
      const codeValue = error instanceof ProviderFault ? error.code : OAUTH_CODES.failed;
      sendControlledError(response, codeValue === OAUTH_CODES.unavailable ? 503 : 400, codeValue);
      return;
    }
    if (!identity || identity.provider !== providerName || !identity.subject || !identity.email) {
      sendControlledError(response, 400, OAUTH_CODES.failed);
      return;
    }
    this.#issueSession(response, this.#findOrCreateOidcUser(identity));
  }

  async #register(request, response) {
    setNoStore(response);
    let body;
    try {
      body = await readJson(request);
    } catch {
      sendControlledError(response, 400, OAUTH_CODES.failed);
      return;
    }
    if (typeof body.email !== "string" || typeof body.password !== "string" || body.password.length < 8) {
      sendJson(response, 400, { code: "AUTH_INVALID_INPUT", message: "invalid email or password" });
      return;
    }
    if (this.#users.has(body.email)) {
      sendJson(response, 409, { code: "AUTH_EMAIL_TAKEN", message: "email is already registered" });
      return;
    }
    const user = localUser(body.email, body.password, typeof body.name === "string" ? body.name : "");
    this.#users.set(user.email, user);
    this.#issueSession(response, user);
  }

  async #login(request, response) {
    setNoStore(response);
    let body;
    try {
      body = await readJson(request);
    } catch {
      sendJson(response, 400, { code: "AUTH_INVALID_CREDENTIALS", message: "invalid email or password" });
      return;
    }
    const user = this.#users.get(body.email);
    if (!user || user.provider !== "local" || user.password !== body.password) {
      sendJson(response, 401, { code: "AUTH_INVALID_CREDENTIALS", message: "invalid email or password" });
      return;
    }
    this.#issueSession(response, user);
  }

  async #refresh(request, response) {
    setNoStore(response);
    const raw = parseCookies(request).get("refresh_token");
    const session = raw ? this.#refreshTokens.get(raw) : null;
    if (!session || session.expiresAt <= Date.now()) {
      response.setHeader("Set-Cookie", cookieHeader("", { secure: this.#secure, sameSite: this.#sameSite, maxAge: 0 }));
      sendJson(response, 401, { code: "AUTH_INVALID_TOKEN", message: "invalid or expired refresh token" });
      return;
    }
    this.#refreshTokens.delete(raw);
    const user = [...this.#users.values()].find((candidate) => candidate.id === session.userId);
    if (!user) {
      sendJson(response, 401, { code: "AUTH_INVALID_TOKEN", message: "invalid or expired refresh token" });
      return;
    }
    this.#issueSession(response, user);
  }

  async #logout(request, response) {
    const raw = parseCookies(request).get("refresh_token");
    if (raw) this.#refreshTokens.delete(raw);
    response.setHeader("Set-Cookie", cookieHeader("", { secure: this.#secure, sameSite: this.#sameSite, maxAge: 0 }));
    sendNoContent(response);
  }

  async handle(request, response) {
    const url = new URL(request.url, "http://fake-api.invalid");
    const corsAllowed = setCors(response, request, this.#allowedOrigins);
    if (request.method === "OPTIONS") {
      sendNoContent(response);
      return;
    }
    if (url.pathname === "/livez" && request.method === "GET") {
      sendJson(response, 200, { status: "ok" });
      return;
    }
    if (["POST"].includes(request.method) && !corsAllowed) {
      sendControlledError(response, 403, "CSRF_ORIGIN_INVALID");
      return;
    }

    if (request.method === "GET" && url.pathname.startsWith("/auth/") && url.pathname.endsWith("/login")) {
      await this.#providerLogin(request, response, url.pathname.split("/")[2]);
      return;
    }
    if (request.method === "POST" && url.pathname.startsWith("/auth/") && url.pathname.endsWith("/exchange")) {
      await this.#providerExchange(request, response, url.pathname.split("/")[2]);
      return;
    }
    if (request.method === "POST" && url.pathname === "/auth/register") {
      await this.#register(request, response);
      return;
    }
    if (request.method === "POST" && url.pathname === "/auth/login") {
      await this.#login(request, response);
      return;
    }
    if (request.method === "POST" && url.pathname === "/auth/refresh") {
      await this.#refresh(request, response);
      return;
    }
    if (request.method === "POST" && url.pathname === "/auth/logout") {
      await this.#logout(request, response);
      return;
    }
    if (request.method === "GET" && url.pathname === "/users/me") {
      const user = this.#bearerUser(request);
      if (!user) {
        sendJson(response, 401, { code: "AUTH_INVALID_TOKEN", message: "invalid access token" });
        return;
      }
      sendJson(response, 200, { id: user.id, email: user.email, name: user.name });
      return;
    }
    sendJson(response, 404, { code: "NOT_FOUND", message: "not found" });
  }
}

function startServer(server) {
  return new Promise((resolve, reject) => {
    const onError = (error) => {
      server.off("listening", onListening);
      reject(error);
    };
    const onListening = () => {
      server.off("error", onError);
      resolve(server.address().port);
    };
    server.once("error", onError);
    server.once("listening", onListening);
    server.listen(0, "127.0.0.1");
  });
}

function closeServer(server) {
  return new Promise((resolve) => {
    if (!server.listening) {
      resolve();
      return;
    }
    server.close(() => resolve());
  });
}

function serveFrontend(request, response) {
  if (request.method !== "GET" && request.method !== "HEAD") {
    response.writeHead(405);
    response.end();
    return;
  }
  const requested = new URL(request.url, "http://frontend.invalid").pathname;
  const relative = requested === "/app.js" ? "app.js" : requested === "/styles.css" ? "styles.css" : "index.html";
  const file = path.join(FRONTEND_ROOT, relative);
  if (!existsSync(file)) {
    response.writeHead(404);
    response.end();
    return;
  }
  const contentType = relative.endsWith(".js") ? "text/javascript; charset=utf-8" : relative.endsWith(".css") ? "text/css; charset=utf-8" : "text/html; charset=utf-8";
  response.writeHead(200, { "Content-Type": contentType, "Cache-Control": "no-store" });
  if (request.method === "HEAD") response.end();
  else createReadStream(file).pipe(response);
}

function makeTlsMaterial() {
  const directory = mkdtempSync(path.join(tmpdir(), "go-scaffold-e2e-tls-"));
  const keyPath = path.join(directory, "key.pem");
  const certPath = path.join(directory, "cert.pem");
  execFileSync(
    "openssl",
    [
      "req",
      "-x509",
      "-newkey",
      "rsa:2048",
      "-nodes",
      "-keyout",
      keyPath,
      "-out",
      certPath,
      "-days",
      "1",
      "-subj",
      "/CN=127.0.0.1",
      "-addext",
      "subjectAltName=IP:127.0.0.1",
    ],
    { stdio: "ignore" },
  );
  return { directory, key: readFileSync(keyPath), cert: readFileSync(certPath) };
}

export async function createAuthHarness() {
  const frontendServer = createHttpServer(serveFrontend);
  const frontendPort = await startServer(frontendServer);
  const frontendOrigin = `http://localhost:${frontendPort}`;
  const frontendAliasOrigin = `http://127.0.0.1:${frontendPort}`;
  const callbackUri = `${frontendOrigin}${CALLBACK_PATH}`;

  const oidc = new FakeOidcProvider({ callbackUri });
  const oidcServer = createHttpServer((request, response) => oidc.handle(request, response));
  const oidcPort = await startServer(oidcServer);
  oidc.setBaseUrl(`http://127.0.0.1:${oidcPort}`);

  const sameApi = new FakeAuthApi({
    providers: new Map([["google", oidc]]),
    frontendOrigin,
    callbackUri,
    topology: "same-site",
    secure: false,
    sameSite: "Strict",
  });
  const sameApiServer = createHttpServer((request, response) => sameApi.handle(request, response));
  const sameApiPort = await startServer(sameApiServer);
  const sameApiUrl = `http://localhost:${sameApiPort}`;

  const tls = makeTlsMaterial();
  const crossApi = new FakeAuthApi({
    providers: new Map([["google", oidc]]),
    frontendOrigin,
    callbackUri,
    topology: "cross-site",
    secure: true,
    sameSite: "None",
  });
  const crossApiServer = createHttpsServer({ key: tls.key, cert: tls.cert }, (request, response) => crossApi.handle(request, response));
  const crossApiPort = await startServer(crossApiServer);
  const crossApiUrl = `https://127.0.0.1:${crossApiPort}`;

  return {
    frontendOrigin,
    frontendAliasOrigin,
    callbackUri,
    sameApiUrl,
    crossApiUrl,
    sameApi,
    crossApi,
    async close() {
      await Promise.all([closeServer(frontendServer), closeServer(oidcServer), closeServer(sameApiServer), closeServer(crossApiServer)]);
      rmSync(tls.directory, { recursive: true, force: true });
    },
  };
}
