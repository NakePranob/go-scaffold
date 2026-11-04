# Spec Delta

## Purpose

Ensures generated rate limiting keeps its fixed-window counter and expiry
consistent even when a process stops between counter operations.

## ADDED Requirements

### Requirement: Rate-limit counter always has an expiry

When the generated limiter uses a shared counter store, it SHALL create the
counter and its expiry in one atomic operation. A counter created by a request
MUST NOT remain without a time-to-live after that request completes or the
process stops.

#### Scenario: First request starts a bounded window

- **GIVEN** no counter exists for a request key
- **WHEN** the first request arrives
- **THEN** the limiter creates the counter with the configured expiry in the
  same operation

#### Scenario: Interrupted request cannot create a permanent lockout

- **GIVEN** a limiter backed by a shared counter store
- **WHEN** the process stops immediately after the first request is counted
- **THEN** the counter still expires after the configured window and later
  requests are not locked out permanently

### Requirement: Limiter store failures remain fail-closed

The generated limiter SHALL reject the request with a service-unavailable
response when its counter store cannot be read or updated. It MUST NOT treat a
store failure as permission to continue without rate limiting.

#### Scenario: Store outage is not permission

- **GIVEN** the shared counter store is unavailable
- **WHEN** a client calls a rate-limited endpoint
- **THEN** the endpoint returns service unavailable with a retry hint instead
  of processing the request
