## Deterministic browser auth fixture

This is an opt-in, test-only browser harness for the client-owned callback
contract. It is not included in generated projects or the published package.

Install the pinned Chromium binary once, then run:

```text
pnpm run test:e2e:install
pnpm run test:e2e
```

`FakeOidcProvider` is injected into `FakeAuthApi` through a provider registry.
The seam models the authorization request, one-time code, nonce, and S256
verifier checks without adding a production provider bypass. The browser uses
the same public shape as the generated API: `GET /auth/{provider}/login` and
`POST /auth/{provider}/exchange`.

The fixture covers success, provider cancellation/error/unavailability, missing/mismatched/
expired/replayed state, wrong verifier, independent tabs, exact-origin CORS,
local Strict cookies, cross-site None + Secure cookies with an ephemeral local
TLS certificate, fixed callback/redirect handling, and email auth regression.

State and verifier values are generated with Web Crypto. The fixture rejects
whitespace rather than trimming it, keeps the access token in page memory only,
and scrubs the callback URL with `history.replaceState` before rendering a
result. The Playwright config disables trace, screenshot, video, and preserved
failure output; the default output directory is under the OS temporary
directory. The fixture servers do not log request URLs, cookies, codes, or
tokens.

Live Google credentials and native/mobile flows are intentionally out of scope.
