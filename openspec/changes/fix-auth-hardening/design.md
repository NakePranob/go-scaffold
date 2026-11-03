# Design

## Context

See `proposal.md` for motivation. The generated auth module keeps MFA state in
`user_svc.mfa_enrollments` and has one shared TOTP verifier used by login,
reauthentication, enrollment confirmation, and factor disable. The Redis
limiter is one of two `Limiter` adapters; the Postgres path uses an in-process
counter. Browser-origin checking lives in the user HTTP adapter and is also
used by OAuth state-changing routes.

## Goals / Non-Goals

**Goals:**

- Make a TOTP code usable at most once per enrollment, including across
  different challenges and across login/reauthentication.
- Make the Redis limiter's counter creation and expiry one atomic operation.
- Make exact-origin matching accept equivalent canonical spellings while
  still rejecting malformed or different origins.
- Keep existing CLI flags, config keys, and generated route shapes unchanged.

**Non-Goals:**

- Adding WebAuthn/passkeys or an L3 MFA factor.
- Adding a key-rotation workflow for `MFA_ENCRYPTION_KEY`.
- Changing the rate-limit algorithm from fixed window to sliding window.
- Changing the Postgres in-process limiter's cross-replica semantics.
- Providing an automatic migration for projects that were generated before
  this change; the migration plan documents the required `ALTER TABLE`.

## Decisions

### Store the accepted TOTP step in the enrollment

Add `last_totp_step BIGINT NOT NULL DEFAULT 0` to `mfa_enrollments`. The
application computes the matched TOTP time-step and asks the MFA store to
accept it atomically. The Postgres implementation uses a single conditional
`UPDATE ... WHERE user_id = ? AND enabled = true AND last_totp_step < ?` and
reports whether a row changed.

Alternatives considered:

- An in-memory replay cache: rejected because it fails across replicas and
  disappears on restart.
- A separate replay table: rejected because the enrollment already has a
  natural one-row-per-user place for this state and the transaction can update
  it with the existing lock.
- Recording the raw code hash: rejected because the time-step is enough,
  avoids storing additional credential-derived material, and works with the
  existing TOTP window.

`ConfirmEnrollment` takes the matched step and records it during the same
transaction that enables the enrollment. `AcceptTOTPStep` is the shared guard
for login, reauthentication, and disable. A rejected step counts as an MFA
failure so repeated replay attempts are throttled by the existing durable
per-user counter.

### Use one Lua script for the Redis fixed window

Replace `INCR` followed by a separate `EXPIRE` with one script that performs
`INCR` and `PEXPIRE` atomically. `PEXPIRE` preserves sub-second windows and
avoids a permanent key if the process stops after the counter is created.
Store errors still return `(false, err)` so the middleware remains fail-closed.

Alternative considered: keep the two commands and add a compensating `DEL` on
error. Rejected because a process crash can occur before the compensation runs;
only an atomic server-side operation closes that window.

### Canonicalize origins before comparison

Both the request origin and every configured origin are parsed into a canonical
scheme/host/port form. Host and scheme are compared case-insensitively, default
ports for `http`/`https` are removed, and trailing slashes never participate.
Malformed origins are rejected. The comparison remains exact after
canonicalization; no wildcard or suffix matching is introduced.

Alternative considered: normalize only the configured list at startup. Rejected
because requests can arrive with equivalent but differently-spelled origins,
and the same helper should be the single source of truth for both sides.

## Risks / Trade-offs

- [Existing generated projects lack the new column] → Document a one-line
  `ALTER TABLE` in the generated auth docs; new projects get the column from
  `create_mfa`.
- [TOTP codes near a time-step boundary may be accepted for a neighboring
  step] → The existing configured window is preserved; the guard records the
  step that actually matched, so a later replay of that same code is rejected.
- [A legitimate user who immediately reuses the same code is rejected] →
  This is the intended one-time-code behavior; the user waits for the next
  code. Tests cover the replay path.
- [Canonicalization could accidentally broaden matching] → Only scheme/host
  case and scheme-default ports are normalized; path, query, fragment, user
  info, and non-HTTP(S) schemes remain invalid.

## Migration Plan

- New generated projects receive `last_totp_step` in `create_mfa.up.sql`.
- Existing generated projects need:
  `ALTER TABLE user_svc.mfa_enrollments ADD COLUMN last_totp_step BIGINT NOT NULL DEFAULT 0;`
- Rollback: drop the column after reverting the templates; the replay guard is
  additive and does not rewrite existing MFA data.
- The CLI's own OpenSpec change is archived only after the template tests and
  generated-project tests pass.

## Open Questions

None.
