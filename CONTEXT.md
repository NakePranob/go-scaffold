# Authentication Context

This context defines the language used by the generated authentication domain. It keeps primary login identities, second-factor enrollment, and the temporary proof needed to start a session distinct.

## Accounts and login

**User**:
A person who owns a profile and may have one or more ways to sign in.
_Avoid_: Account, customer

**Identity**:
A login method belonging to a user, such as a password identity or an external provider identity.
_Avoid_: Credential, account

**Provider**:
An external identity service that authenticates a user and returns a stable subject for that user.
_Avoid_: Login method, identity

## Multi-factor authentication

**MFA factor**:
A second proof of control required after a primary identity has authenticated.
_Avoid_: MFA account, second password

**MFA enrollment**:
A user's confirmed association with an authenticator factor.
_Avoid_: MFA setup, MFA enabled

**MFA challenge**:
A short-lived proof request issued after primary authentication and before a session is created.
_Avoid_: Session, access token

**Recovery code**:
A one-time fallback proof that can complete an MFA challenge when the enrolled factor is unavailable.
_Avoid_: Backup password, reset token
