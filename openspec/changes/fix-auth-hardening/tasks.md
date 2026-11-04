# Tasks

## 1. MFA replay guard

- [x] 1.1 Add `last_totp_step` to the generated MFA enrollment model and
  `create_mfa` migration, and extend the MFA store port with an atomic
  `AcceptTOTPStep` plus a step-aware `ConfirmEnrollment`; verify with
  `pnpm run build` and the generated Postgres MFA store test.
- [x] 1.2 Refactor TOTP verification to return the matched time-step and apply
  the one-time guard to login verification, reauthentication, enrollment
  confirmation, and disable; verify with generated MFA service unit tests.
- [x] 1.3 Add regression tests for replay through enrollment, login, and
  reauthentication; verify with `go test ./internal/app/user/...` in a generated
  auth project.
- [x] 1.4 Document the one-time TOTP behavior and the existing-project
  `ALTER TABLE` migration; verify the generated ASVS auth doc contains both.

## 2. Redis rate limiter

- [x] 2.1 Replace the Redis limiter's separate `INCR` and `EXPIRE` with one
  atomic Lua script that sets the expiry; verify with the generated middleware
  test and a Redis integration test when `TEST_REDIS_URL` is set.
- [x] 2.2 Add regression coverage for "counter always has a TTL" and keep the
  store-failure fail-closed test; verify with `go test ./internal/shared/middleware/...`.

## 3. Browser origin canonicalization

- [x] 3.1 Canonicalize both request and configured origins in
  `browser_policy.go` (scheme/host case, default ports, trailing slash) while
  rejecting malformed origins; verify with generated handler tests.
- [x] 3.2 Add cases for equivalent spellings and malformed origins; verify with
  `go test ./internal/app/user/adapters/inbound/http/...`.

## 4. Integration verification

- [x] 4.1 Run the CLI build and auth-focused integration tests; verify
  `pnpm run build` and `node --test tests/integration/auth-*.test.mjs` pass.
- [x] 4.2 Generate fresh Postgres and Redis auth projects and run their tests,
  `go vet`, and `go-scaffold check`; verify all commands pass.
- [x] 4.3 Run `openspec validate fix-auth-hardening --strict` and confirm the
  change has no validation warnings.

## Workflow follow-up

- Archive the OpenSpec change after the final review and verification pass.
