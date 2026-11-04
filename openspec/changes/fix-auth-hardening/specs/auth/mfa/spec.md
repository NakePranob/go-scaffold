# Spec Delta

## Purpose

Ensures generated MFA verification treats TOTP codes as one-time proofs and
rejects a code that was already accepted for the same enrollment.

## ADDED Requirements

### Requirement: TOTP code is accepted at most once

The generated authentication service SHALL record the TOTP time-step that was
accepted for an MFA enrollment. It MUST reject any later verification whose
matched time-step is not newer than the recorded step.

#### Scenario: First valid code is accepted

- **GIVEN** an enabled MFA enrollment and a valid TOTP code for the current
  time-step
- **WHEN** the user submits the code with a valid MFA challenge
- **THEN** the service accepts the code, records that time-step, and issues a
  session

#### Scenario: Replayed code is rejected

- **GIVEN** a TOTP code that was already accepted for the enrollment
- **WHEN** the same code is submitted with a new MFA challenge inside the
  configured verification window
- **THEN** the service rejects the challenge and does not issue a session

### Requirement: Replay guard covers every MFA code path

The generated authentication service SHALL apply the same one-time TOTP rule
to login verification, reauthentication, initial enrollment confirmation, and
MFA disable. A successful code MAY only advance the recorded time-step once.

#### Scenario: Reauthentication cannot reuse a login code

- **GIVEN** a TOTP code accepted during login
- **WHEN** the authenticated user presents the same code to a sensitive-action
  reauthentication request
- **THEN** reauthentication fails and the existing session remains unchanged

#### Scenario: Enrollment confirmation stores the first step

- **GIVEN** a pending MFA enrollment and a valid TOTP code
- **WHEN** the user confirms enrollment
- **THEN** the enrollment becomes enabled with that code's time-step recorded
