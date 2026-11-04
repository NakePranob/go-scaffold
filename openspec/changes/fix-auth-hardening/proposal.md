# Proposal

## Why

The generated authentication surface has three hardening gaps that pass the
current tests but weaken the security contract: TOTP codes can be replayed
inside their validity window, the Redis rate limiter can leave a counter with
no TTL, and browser-origin checks compare unnormalized strings. These are
small, isolated defects in the generated auth templates and should be fixed at
the source so every newly generated project inherits the fix.

## What Changes

- Record the accepted TOTP time-step per MFA enrollment and reject a code whose
  step has already been consumed; apply the same guard to login verification,
  reauthentication, enrollment confirmation, and factor disable.
- Replace the Redis limiter's separate `INCR` + `EXPIRE` calls with one atomic
  Lua script so a crash or interrupted command cannot leave a counter without
  a TTL.
- Canonicalize both the request origin and every configured allowed origin
  before comparing them, including default-port and host-case normalization.
- Add regression coverage in the generated auth test templates and the CLI
  integration suite for all three behaviors.
- Document the new MFA replay behavior in the generated auth/security docs.

## Capabilities

### New Capabilities

- `auth/mfa`: one-time TOTP verification and replay rejection across every
  generated MFA verification path.
- `auth/rate-limiting`: atomic fixed-window rate-limit counters with a bounded
  TTL for the Redis-backed limiter.
- `auth/browser-origin`: canonical exact-origin matching for state-changing
  browser requests.

### Modified Capabilities

- None. There are no existing OpenSpec capability specs in this repository.

## Impact

- `templates/add/auth/internal/app/user/application/mfa_service.go.hbs`
- `templates/add/auth/internal/app/user/ports/repository.go.hbs`
- `templates/add/auth/internal/app/user/adapters/outbound/postgres/mfa_store.go.hbs`
- `templates/add/auth/internal/app/user/adapters/outbound/postgres/model.go.hbs`
- `templates/add/auth/migrations/create_mfa.up.sql.hbs`
- `templates/add/auth/internal/shared/middleware/ratelimit_redis.go.hbs`
- `templates/add/auth/internal/app/user/adapters/inbound/http/browser_policy.go.hbs`
- Generated auth tests (`mfa_service_test.go.hbs`, `handler_test.go.hbs`,
  middleware tests) and CLI integration tests.
- No public CLI flag or config key is added or renamed. Existing generated
  projects need a manual migration to add `last_totp_step` if they want the
  replay fix without regenerating.
