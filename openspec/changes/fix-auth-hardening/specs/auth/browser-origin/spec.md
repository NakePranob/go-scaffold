# Spec Delta

## Purpose

Ensures generated browser-origin checks compare canonical origins so valid
deployment configuration is not rejected because of harmless URL spelling.

## ADDED Requirements

### Requirement: Origin matching is canonical

The generated auth boundary SHALL parse and canonicalize both the request
origin and each configured allowed origin before comparing them. Matching MUST
ignore case in the scheme and host, a trailing slash, and a default port for
the scheme.

#### Scenario: Equivalent origin spellings match

- **GIVEN** an allowed origin configured as `https://App.Example.com/`
- **WHEN** a browser sends `Origin: https://app.example.com:443`
- **THEN** the state-changing request is allowed

#### Scenario: Different origin does not match

- **GIVEN** an allowed origin of `https://app.example.com`
- **WHEN** a browser sends `Origin: https://evil.example.com`
- **THEN** the state-changing request is rejected with the origin error

### Requirement: Malformed origins are rejected

The generated auth boundary SHALL reject an origin that is not an absolute
HTTP or HTTPS origin with a host and no path, query, fragment, opaque part, or
user information.

#### Scenario: Origin with a path is rejected

- **GIVEN** any configured allowlist
- **WHEN** a request supplies `Origin: https://app.example.com/path`
- **THEN** the state-changing request is rejected
