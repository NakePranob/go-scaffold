# Auth / Security Checklist

สถานะของระบบ auth ที่สร้างโดย `@nakedev/go-scaffold` ณ วันที่ **2026-09-26**

เอกสารนี้เป็น checklist สำหรับตรวจ generated project และ deployment จริง ไม่ใช่ใบรับรอง ASVS และไม่ควรใช้คำว่า “ผ่าน ASVS” จากการที่ source code หรือ test ผ่านเพียงอย่างเดียว

## วิธีอ่านสถานะ

- `[x] ทำแล้ว` — มี implementation และมี source/test evidence ใน scaffold
- `[~] ทำบางส่วน` — มีโครงสร้างหรือ runtime control แล้ว แต่ยังขาด policy, integration, deployment evidence หรือ manual assessment
- `[ ] ยังขาด` — ยังไม่มี implementation หรือยังเป็น blocker ของระดับนั้น
- `[?] ยืนยันไม่ได้` — ต้องตรวจ generated project, provider จริง หรือ production configuration
- `N/A` — ใช้ได้เมื่อ product owner ตัดสินใจว่า scope นั้นไม่มีจริงและบันทึกเหตุผลไว้แล้ว

ระดับในตารางหมายถึงระดับข้อกำหนดของ ASVS ไม่ใช่ระดับความรุนแรงของ bug และ `generated state` ไม่เท่ากับ `compliance evidence`

## สรุปผู้บริหาร

| เป้าหมาย | สถานะใน scaffold | ความหมาย |
|---|---|---|
| ASVS L1 | `[~]` generated baseline | มี password/session/rate-limit/token controls หลายส่วน แต่ยังต้องเติมหลักฐานเรื่อง common-password policy, account lifecycle และ deployment |
| ASVS L2 | `[~]` generated enforcement + evidence gap | profile L2 บังคับให้ production เปิด `AUTH_MFA_ENABLED=true` และ `AUTH_MFA_REQUIRED_FOR_LOGIN=true`; ผู้ใช้ที่ยังไม่ enroll จะเข้า enrollment flow ก่อนรับ application session แต่ยังต้องทำ product/deployment evidence ให้ครบ |
| ASVS L3 | `[ ]` ไม่ได้ implement เป็น target ที่เลือกได้ | wizard ปฏิเสธ L3 โดยตั้งใจ เพราะยังไม่มี phishing-resistant factor, security notifications, factor-revocation และ high-value step-up ครบ |
| OAuth | `[~]` flow ถูกทิศทาง | ใช้ authorization-code + PKCE S256 และ refresh rotation ใน generated flow แต่ต้องตรวจ provider metadata, `acr`/`amr`/`auth_time` และ production redirect/config |
| Production readiness | `[~]` ต้องตรวจแยก | source guard ไม่ได้พิสูจน์ TLS, proxy, secret rotation, SMTP, monitoring, backup หรือ live provider configuration |

### High-risk source gaps ที่ checklist นี้ต้องไม่กลบ

- session list/revoke และ admin session termination ต้องยังมี product policy, audit และ production evidence แม้ generated route จะบังคับ recent-auth และมี RBAC guard แล้ว
- MFA L2 ถูกบังคับใน production profile ผ่าน enrollment-before-session flow แต่ยังขาด lost-factor recovery, notification และ live IdP assurance evidence
- auth module ยังไม่มี user disable/delete lifecycle, notification framework หรือ scheduled operational evidence สำหรับ auth cleanup ครบชุด
- scaffold ยังไม่สร้าง WebAuthn/passkey, suspicious-login notification, factor-loss revocation หรือ high-value transaction step-up จึงยังไม่ควรเปิด L3
- key rotation, object/tenant authorization และ production observability ต้องทำที่ generated application/deployment เพิ่มเติม; baseline security headers ถูกสร้างให้แล้วแต่ต้องตรวจที่ proxy/browser จริง

## ขอบเขตและหลักฐานที่ต้องแยกกัน

ทุก requirement ควรมีหลักฐานอย่างน้อยหนึ่งชนิดต่อไปนี้

1. **Generated source** — template/CLI สร้าง control อะไรให้
2. **Automated test** — unit, integration, smoke หรือ generated-project test
3. **Product policy** — ค่าที่ product เลือก เช่น session timeout, MFA policy, recovery policy
4. **Deployment evidence** — environment, reverse proxy, TLS, Redis/Postgres, SMTP, provider และ secret rotation
5. **Manual assessment** — ลองโจมตี/ทดสอบ flow, ตรวจ log, ตรวจ recovery และตรวจ UI/operation

ASVS เป็นมาตรฐานสำหรับการตรวจสอบ ไม่ใช่การรับรองอัตโนมัติ โดย OWASP ระบุว่าการประเมินต้องกำหนด scope, ตรวจ requirements, source/configuration/documentation และหลักฐานของระบบจริงให้ครบตามระดับที่ประกาศ

## 1. Generated security profile และ wizard

- [x] `--asvs-level` สร้าง security profile ลงใน generated project แทนการเป็นเพียง target label
- [x] L1 เปิด baseline password policy และ common-password screening
- [x] L2 เพิ่ม breached-password screening และ sensitive-action MFA requirement hook
- [x] L3 ถูก reject ก่อนเขียนไฟล์ เพราะ generated controls ยังไม่เพียงพอ
- [x] CLI ตรวจ flag/profile ที่ไม่สอดคล้องกันและตรวจ profile ใน `go-scaffold check`
- [~] profile เป็น **generated security baseline** ไม่ใช่ certification claim
- [ ] ยังต้องกำหนดใน generated project ว่า profile ถูกบันทึกเป็น policy artifact ที่ทีม deploy/review ต้อง sign-off อย่างไร
- [ ] ยังต้องมี acceptance test ที่ตรวจว่าแต่ละ profile สร้าง behavior ที่ product ตั้งใจจริงใน generated application

หลักฐานใน repository: `src/prompts/auth-wizard.ts`, `src/utils/auth-patcher.ts`, `templates/add/auth/internal/app/user/application/security_profile.go.hbs`, `templates/add/auth/docs/asvs-auth.md.hbs`

## 2. ASVS Level 1 — baseline

### 2.1 Password และ local authentication

- [x] ใช้ adaptive one-way password hashing ตาม generated adapter และไม่เก็บ plaintext password
- [x] มี password policy และ test สำหรับ password validation
- [~] มี common-password screening และ production guard บังคับ `AUTH_COMMON_PASSWORDS_FILE` ที่สั้นกว่า 3,000 policy-matching entries ไม่ผ่าน แต่ยังต้องยืนยัน provenance, update procedure และ test ของรายการที่ deploy
- [x] password change/reset มีการ rotate หรือ revoke session ตาม flow ที่ generated ไว้
- [~] default operator/admin ไม่ได้ถูกสร้างด้วย credential เดียวแบบ hard-coded แต่ deployment ต้องพิสูจน์ว่า secret ถูกส่งผ่าน secret manager/env ที่ปลอดภัย
- [ ] ต้องตรวจให้ครบว่าการสร้าง account, disable account และ delete account มี lifecycle policy และ audit ที่สอดคล้องกัน

อ้างอิงหลัก: ASVS V6.2.1–V6.2.8, V6.3.1–V6.3.2

### 2.2 Brute force และ anti-automation

- [x] มี login/recovery rate-limit และ lockout policy ใน generated auth
- [x] มี test สำหรับ failed attempts, lockout และ recovery behavior
- [~] ป้องกัน malicious lockout และ distributed attack ต้องทดสอบกับ Redis/shared store ใน deployment จริง ไม่ใช่เฉพาะ process เดียว
- [~] ต้องกำหนด response, alert และ operator runbook เมื่อเกิด credential stuffing

อ้างอิงหลัก: ASVS V6.1.1, V6.3.1 และ OWASP Authentication Cheat Sheet

### 2.3 Session/token baseline

- [x] backend ตรวจ session/token ทุก protected request
- [x] access token เป็น dynamic token และ refresh token ถูก hash ก่อนเก็บใน database/Redis
- [x] authentication success สร้าง/rotate token และ invalidate token ตาม lifecycle
- [x] session list จำกัดจำนวนรายการและ preserve current session ได้
- [x] refresh-token rotation มี atomic limit/eviction path สำหรับ PostgreSQL และ Redis adapter
- [x] new login evict session ที่เก่าที่สุดเมื่อเกิน `AUTH_MAX_SESSIONS`
- [~] ต้องตรวจว่า inactivity timeout และ absolute session lifetime ถูกกำหนดเป็น policy ชัดเจนและทดสอบในทุก deployment
- [~] ถ้ามี account disable/delete ต้อง invalidate active sessions ทั้งหมดเมื่อ lifecycle event เกิดขึ้น
- [~] generated `cmd/auth-cleanup` / `make auth-cleanup` ล้าง expired token/MFA state และ stale Redis session indexes ได้แล้ว; ยังต้อง schedule และเก็บ production run/metric evidence

อ้างอิงหลัก: ASVS V7.2.1–V7.2.4, V7.4.1–V7.4.2

### 2.4 Browser, cookie และ API boundary

- [x] state-changing cookie routes มี exact-origin guard แยกจาก CORS เพื่อป้องกัน CSRF
- [x] CORS สะท้อนเฉพาะ origin ที่ allowlist ไว้และไม่ใช้ `*` ร่วมกับ credentials
- [x] cross-site topology บังคับ `SameSite=None` + `Secure`; production บังคับ `COOKIE_SECURE=true`
- [x] refresh และ OAuth state cookie เป็น `HttpOnly`; secure deployment ใช้ `__Host-` cookie name
- [x] auth responses ใส่ `Cache-Control: no-store` และ `Pragma: no-cache` ใน token-bearing paths
- [x] access token อยู่ใน response body ส่วน refresh token ไม่ถูก echo กลับและอยู่ใน HttpOnly cookie
- [~] same-site mode อนุญาต request ที่ไม่มี `Origin` เพื่อรองรับ non-browser clients; ต้องบันทึกว่า endpoint ใดรับการใช้งานแบบนี้ได้
- [~] `TRUSTED_PROXIES` ต้องกำหนดให้ถูกต้อง เพราะ `ClientIP()` ใช้กับ rate-limit, lockout และ session metadata
- [x] base template สร้าง security headers (`HSTS` เฉพาะ production, CSP, frame protection, `X-Content-Type-Options`, Referrer-Policy, Permissions-Policy และ cross-origin policies)

อ้างอิงหลัก: OWASP CSRF Prevention Cheat Sheet, ASVS V3/V4 และ source `browser_policy.go.hbs`, `cors.go.hbs`, `session_cookie.go.hbs`

### 2.5 Password recovery และ email verification

- [x] forgot-password ตอบข้อความเดียวกันทั้ง account มี/ไม่มี เพื่อลด user enumeration
- [x] reset token และ email-verification token เก็บเฉพาะ hash, เป็น one-time และมี TTL
- [x] reset password consume token กับ update credential ใน transaction เดียว
- [x] reset password revoke refresh sessions ทั้งหมด และ access-token rejection ขึ้นกับ session validator ที่ composition root ต้อง wire ให้ครบ
- [x] forgot-password, reset-password, verify-email และ resend-verification มี rate-limit ตาม route
- [~] registration ออก session ได้ก่อน email verification; product ต้องตัดสินใจว่าจะอนุญาต unverified session หรือบังคับ verify ก่อนใช้บาง capability
- [~] email delivery เป็น best-effort ใน generated flow; ต้องมี retry/outbox/alert หาก email เป็น security-critical control
- [ ] ยังไม่มี notification หลัง password reset/change และยังไม่มี account recovery ที่ผูกกับ phishing-resistant factor
- [ ] ต้องกำหนด token cleanup/retention ของ reset และ verification rows ใน production

อ้างอิงหลัก: [OWASP Forgot Password Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Forgot_Password_Cheat_Sheet.html), ASVS V6.4 และ source `recovery_service.go.hbs`

### 2.6 Identity linking และ account lifecycle

- [x] external identity ใช้ `(issuer, subject)` เป็น stable key ไม่ใช้ email เป็น primary identity
- [x] database กัน provider identity เดิมซ้ำทั้งข้าม user และซ้ำ provider ภายใน user
- [x] auto-link กับ account เดิมทำได้เมื่อ external email verified เท่านั้น
- [x] link/unlink identity ใช้ recent-auth proof และป้องกันการลบ identity สุดท้าย
- [x] identity-link OAuth transaction bind กับ authenticated user จึงไม่ attach identity ให้ user อื่นจาก callback เดียวกัน
- [~] ต้องกำหนด notification, session revocation และ incident response เมื่อ identity ถูก link/unlink
- [~] ต้องตรวจ issuer canonicalization และ provider configuration ของทุก IdP ที่เพิ่มภายหลัง ไม่ใช่ถือว่า Google adapter เป็น policy กลางทั้งหมด
- [ ] auth module ยังไม่มี user disable/delete use case ที่กำหนดการ revoke tokens, cascade data และ audit ครบ

อ้างอิงหลัก: ASVS V6.8, V7.4 และ source `external_login.go.hbs`, `identities.go.hbs`, `create_external_identities.up.sql.hbs`

## 3. ASVS Level 2 — ต้องตัดสินใจ product policy เพิ่ม

### 3.1 MFA และ authentication strength

- [x] มี TOTP setup/confirm/disable และ recovery-code primitives
- [x] sensitive action มี re-auth/MFA guard hook
- [x] มี `AUTH_MFA_ENABLED` + `AUTH_MFA_REQUIRED_FOR_LOGIN` และ L2 security profile fail-closed ใน production เมื่อ MFA enforcement ไม่เปิด
- [x] เมื่อ L2 production enforcement เปิด ผู้ใช้ที่ยังไม่ enroll จะได้ restricted enrollment token และต้อง setup/confirm MFA ก่อนรับ application session
- [~] local login, OIDC login, recovery และ identity-link ต้องพิสูจน์ว่า auth strength สอดคล้องกันทุกทาง
- [ ] lost-MFA-factor recovery ต้องทำ identity proofing ที่ไม่น้อยกว่าระดับตอน enroll และต้องไม่ใช้ session เดิมอย่างเดียว
- [~] ควร notify ผู้ใช้เมื่อ MFA factor ถูกเพิ่ม/เปลี่ยน/ลบ แม้ข้อกำหนด notification บางข้อจะอยู่ L3 แต่เป็น operational security baseline ที่ควรทำ

อ้างอิงหลัก: ASVS V6.3.3–V6.3.4, V6.4.3–V6.4.4 และ OWASP MFA Cheat Sheet

### 3.2 MFA implementation details

- [x] TOTP/recovery code ใช้ one-time verification และมี expiration/attempt controls ตาม generated flow
- [x] secret/token generation ใช้ CSPRNG path ที่มี test รองรับ
- [~] ต้องยืนยันเวลาของ server ที่ใช้ตรวจ TOTP และกำหนด clock-drift policy ใน production
- [~] ต้องยืนยันว่า MFA secret และ recovery codes encrypted/protected ตาม deployment secret policy
- [ ] ยังไม่มี factor replacement/recovery flow ที่ครบสำหรับ lost device, compromised factor และ helpdesk escalation

อ้างอิงหลัก: ASVS V6.5.1–V6.5.5, NIST SP 800-63B

### 3.3 Session policy และ session administration

- [x] `AUTH_MAX_SESSIONS` มี validation, bounded value และ atomic eviction เพื่อลด race condition
- [x] session list และ revoke current/selected session มี generated API/DTO/doc
- [~] ต้องประกาศ inactivity timeout, absolute timeout และ behavior เมื่อ max sessions ถึง limit เป็น product policy ที่ตรวจได้
- [x] session list บังคับ short-lived recent-auth proof และ revoke route ใช้ boundary เดียวกัน
- [x] เมื่อเปิด RBAC มี `DELETE /users/{id}/sessions/{session_id}` พร้อม `user:manage-session` permission สำหรับ admin termination
- [~] password change มี session revocation แต่ MFA factor change และ identity-link change ต้องตรวจว่าควร revoke ทั้งหมดหรือบังคับ re-auth ตาม risk หรือไม่

อ้างอิงหลัก: ASVS V7.1.1–V7.1.2, V7.3.1–V7.3.2, V7.4.3–V7.4.5, V7.5.1–V7.5.2

### 3.4 OAuth/OIDC identity provider

- [x] generated OAuth flow ใช้ authorization-code + PKCE และไม่ใช้ implicit grant ใน flow ที่สร้าง
- [x] PKCE ใช้ S256 ใน generated flow
- [x] refresh-token rotation มี replay-prevention path
- [x] server เก็บ hashed OAuth transaction ที่ bind provider, state, S256 challenge, nonce, caller และ expiry พร้อม consume แบบ one-time
- [x] Google adapter ตรวจ ID-token signature/algorithm, issuer, audience, `azp`, expiry, issued-at, nonce และ subject ที่ตรงกับ userinfo
- [x] provider userinfo subject ต้องตรงกับ ID-token subject ก่อนนำ identity ไปใช้
- [~] ต้องตรวจ issuer, audience, nonce/state, redirect URI และ provider metadata ใน generated project ที่เลือก provider จริง
- [~] ต้องตรวจ `acr`, `amr`, `auth_time` หรือ documented fallback ก่อนยอมรับ IdP authentication strength/recentness
- [~] ต้องกำหนด federated session lifetime และ re-auth behavior ให้สอดคล้องกับ local session policy
- [~] OAuth state cookie เป็น single browser cookie; ต้องทดสอบ concurrent tabs/parallel login-link transactions และกำหนด behavior ที่ยอมรับได้
- [ ] ยังไม่มี live-provider evidence ใน checklist นี้ เพราะต้องใช้ credentials, callback URL และ environment ของผู้ deploy

อ้างอิงหลัก: RFC 9700 และ ASVS V6.8.4, V7.6.1–V7.6.2

## 4. ASVS Level 3 — ยังไม่พร้อมใช้งานใน scaffold

ส่วนนี้ควรแสดงเป็น `[ ]` จนกว่าจะมี implementation และ evidence จริง ไม่ควรเปิด flag เพียงเพื่อให้ดูว่าเป็น L3

- [ ] phishing-resistant authenticator ที่ hardware-backed หรือมีคุณสมบัติเทียบเท่า เช่น WebAuthn/passkey ตาม threat model
- [ ] L3 authentication factor policy และ user-initiated action สำหรับการใช้ factor ที่แข็งแรง
- [ ] notification เมื่อเกิด suspicious authentication attempt
- [ ] notification เมื่อ authentication detail เปลี่ยน เช่น password, MFA factor, recovery method หรือ linked identity
- [ ] factor revocation เมื่อ device/factor สูญหายหรือถูกขโมย
- [ ] high-value operation step-up authentication แยกจากการมี session อยู่แล้ว
- [ ] adaptive/risk-based authentication และ detection ของ anomalous login
- [ ] trusted server time และ operational monitoring ที่พิสูจน์ได้สำหรับ factor/session security
- [x] wizard ปฏิเสธ L3 แทนการสร้าง project ที่อ้าง L3 แต่ขาด controls

หมายเหตุ: ASVS ระบุ property “phishing-resistant” ไม่ได้บังคับชื่อผลิตภัณฑ์ใดเป็นพิเศษ แต่ WebAuthn/passkey เป็นแนวทางที่เหมาะกับเป้าหมายนี้มากกว่า password หรือ manual OTP ซึ่งไม่ phishing-resistant ตาม NIST

อ้างอิงหลัก: ASVS V6.3.3, V6.3.5–V6.3.7, V6.5.6, V7.5.3, V8.2.4 และ NIST SP 800-63B

## 5. Authorization และ RBAC (optional feature แต่ต้อง review เมื่อเปิดใช้)

- [x] `add rbac` แยก role/permission catalog ออกจาก auth และใช้ exact permission checks
- [x] protected RBAC routes ตรวจ authentication ก่อน authorization และตอบ 401/403 แยกกัน
- [x] system roles (`staff`, `admin`) กันการลบ และมี last-role-manager guard
- [x] role change revoke refresh sessions ก่อนเปลี่ยน role เพราะ role อยู่ใน access token
- [x] permission update invalidate local authz cache ทันทีใน process เดียวกัน
- [~] authz cache ข้าม pod อาจ stale จนถึง TTL; ต้องเลือก TTL/Redis pub-sub และตรวจ behavior ตอน permission ถูกถอน
- [~] role-management route ยังต้องทบทวน recent-auth/step-up policy สำหรับการเปลี่ยนสิทธิ์ผู้ใช้หรือ role ที่มีอำนาจสูง
- [~] ต้องมี audit log สำหรับ grant/revoke permission, role change, role delete และ admin user lookup
- [ ] generic RBAC ไม่ได้สร้าง object-level/tenant-level authorization ให้อัตโนมัติ; ทุก generated domain ต้องตรวจ resource ownership/scope เอง
- [ ] ต้องมี negative tests ว่า user ที่มี permission ของ resource หนึ่งไม่สามารถเข้าถึง resource อื่นหรือข้าม tenant ได้

อ้างอิงหลัก: ASVS V8 และ source `templates/add/rbac/`; ถ้าไม่ได้เปิด `add rbac` ให้บันทึก `N/A` พร้อมระบุว่า application ใช้ authorization แบบใดแทน

## 6. OAuth 2.0 / OIDC checklist

- [x] authorization code flow
- [x] PKCE S256
- [x] refresh-token rotation / old-token invalidation path
- [x] state transaction, nonce, issuer, audience และ provider subject validation มี generated Google adapter/test coverage
- [~] redirect URI ต้องเป็น exact allowlist ที่ provider และ frontend configuration ตรงกัน และไม่รับ arbitrary redirect จาก request
- [x] generated browser flow ไม่ใส่ access/refresh token ใน URL และใช้ no-store token response headers
- [~] ต้องตรวจว่า provider access token, authorization code, verifier และ ID token ไม่หลุด application/proxy log
- [~] ต้องกำหนด refresh-token reuse detection, family revocation และ incident response ให้ชัด
- [~] ต้องตรวจ key-fetch timeout, JWKS cache refresh และ provider key rotation ใน production
- [ ] ยังไม่มี live integration test สำหรับทุก provider ที่ scaffold รองรับ

ข้อกำหนดใน RFC 9700 เป็น normative protocol guidance เช่น authorization server ต้องรองรับ PKCE และ S256 เป็นวิธีที่ปลอดภัยกว่า plain verifier exposure; แต่การมี code path ใน scaffold ยังไม่ยืนยัน configuration ของ provider จริง

## 7. Session, data และ privacy

- [x] refresh token เก็บเป็น hash ไม่เก็บค่าใช้งานจริงใน persistence
- [x] session record มี identity/session metadata สำหรับ list/revoke
- [x] session cap และ eviction ใช้ atomic path ใน PostgreSQL/Redis adapter
- [x] session list ไม่เปิดเผย refresh token หรือ secret
- [x] user email normalized มี unique constraint และ primary-email invariant
- [x] external identities และ MFA enrollment/recovery-code tables มี foreign-key/cascade rules ตาม schema ที่สร้าง
- [x] MFA secret ถูกเข้ารหัส ส่วน MFA challenge/recovery code/refresh/recovery token เก็บเป็น hash หรือ one-time state
- [x] auth token tables มี expiry/absolute-expiry/session indexes และ login throttle มี retention sweep ระหว่าง failed login
- [~] ต้อง review ว่า user-agent/IP/device metadata มี minimization, retention และ privacy policy
- [~] ต้องกำหนด inactivity/absolute expiry ของ access และ refresh session เป็นตัวเลขที่ audit ได้
- [x] `auth_tokens.user_id` มี FK + `ON DELETE CASCADE`; nullable เฉพาะ anonymous OAuth state ที่ยังไม่มี user
- [x] `AUTH_METADATA_KEY` แยกจาก `JWT_SECRET` สำหรับ device/throttle metadata และ production guard ตรวจ default/length/equality
- [~] JWT signing key และ `MFA_ENCRYPTION_KEY` ยังไม่มี key-version/rotation migration workflow ใน scaffold
- [~] มี cleanup command ที่ cron/CronJob เรียกได้ และทำงานแบบ idempotent; ยังต้องเพิ่ม scheduler/metric/alert evidence ใน deployment จริง
- [ ] ต้องกำหนด incident procedure เมื่อพบ refresh-token reuse หรือ session hijacking
- [~] ต้องทำ live Redis adapter test ด้วย `TEST_REDIS_URL`; หากไม่มี env test จะ skip จึงยังไม่ใช่หลักฐานของ Redis production path

## 8. Deployment และ operations

- [x] generated code มี production guards สำหรับ security profile/config ที่อันตรายถ้าปล่อย default
- [~] production secret ต้องมาจาก secret manager/secure environment และมี rotation procedure
- [~] TLS, HSTS, secure cookie, SameSite, CORS และ trusted-proxy configuration ต้องตรวจที่ reverse proxy/ingress จริง
- [~] scaffold สร้าง baseline security headers แล้ว แต่ต้องทดสอบผ่าน browser/proxy จริงและปรับ CSP ตาม frontend topology
- [~] SMTP/email delivery และ reset/MFA notification ต้องทดสอบจริงโดยไม่ log token หรือ reset link แบบเต็ม
- [ ] authentication events ต้องมี structured audit log, alert และ correlation id โดยไม่เก็บ credential/secret
- [ ] ต้องมี monitoring สำหรับ brute force, lockout spike, refresh-token reuse, MFA recovery และ admin session termination
- [ ] ต้องมี backup/restore/rotation evidence สำหรับ auth database และ key material
- [~] limiter ปัจจุบัน fail-open เมื่อ backing store ใช้งานไม่ได้; ต้องยอมรับ risk นี้ใน policy หรือเพิ่ม fail-closed/secondary control สำหรับ endpoint สำคัญ
- [~] PostgreSQL integration path มี test evidence จาก verification ล่าสุด
- `[?]` Redis live auth-token adapter ยังยืนยันไม่ได้ถ้าไม่มี `TEST_REDIS_URL`
- `[?]` OAuth/OIDC live provider behavior ยังยืนยันไม่ได้หากไม่มี provider credentials และ callback environment

## 9. สถานะ verification ของ scaffold

การตรวจล่าสุดของชุด auth ที่มีอยู่ก่อนสร้าง checklist นี้:

- `[x]` deterministic verification ผ่าน: build, unit 32/32, integration 107/107 และ smoke 57/57 ผ่านในการรันแยก
- `[~]` `pnpm run verify` รอบล่าสุดติด network timeout จาก `proxy.golang.org` ตอน generated smoke ดาวน์โหลด test-only modules; ไม่ใช่ test assertion หรือ generated compile failure
- `[x]` `git diff --check` ผ่าน
- `[~]` Redis adapter live integration ไม่ได้ถูก exercise เมื่อไม่มี `TEST_REDIS_URL`; generated test compile และ skip ตาม environment
- `[?]` ไม่ได้แปลว่า production deployment ผ่าน เพราะ verify ไม่ได้ตรวจ TLS, proxy, secret manager, SMTP, provider และ monitoring จริง

คำสั่งที่ควรใช้กับ generated project:

```bash
go-scaffold check
go test ./...
go vet ./...
```

และควรเติม integration/smoke environment ตาม adapter ที่เลือก เช่น PostgreSQL, Redis และ OAuth provider ก่อนประกาศ readiness

## 10. Action plan ที่แนะนำ

### P0 — ก่อนเรียก L1/L2 พร้อม

- [x] กำหนด generated L2 production policy ให้ MFA ต้องผ่าน enrollment ก่อนออก application session; product ยังต้องเลือก UX/recovery ที่เหมาะสม
- [~] generated code ตรวจว่า common-password corpus มีอย่างน้อย 3,000 policy-matching entries; ยังต้องบันทึก source/provenance, refresh และ sign-off ของรายการที่ deploy
- [ ] กำหนด account disable/delete และ session termination behavior
- [ ] กำหนด inactivity/absolute timeout เป็น policy พร้อม tests
- [ ] ทดสอบ distributed rate-limit/lockout กับ Redis จริง
- [x] บังคับ recent-auth ก่อน session list/revoke และเพิ่ม admin session termination ภายใต้ RBAC
- [~] baseline security headers และ key separation ทำแล้ว; ยังต้องเติม trusted-proxy test และ key rotation workflow
- [ ] เติม explicit browser/API tests สำหรับ CORS, CSRF origin, cookie flags และ no-store ทุก auth response

### P1 — ปิด L2 ที่เป็น product/security workflow

- [x] generated L2 บังคับ MFA enrollment ก่อน application access เมื่อ deploy ด้วย required flags; ยังต้องทดสอบทุก login/provider path ใน product จริง
- [ ] ทำ lost-factor recovery พร้อม identity proofing
- [~] เพิ่ม admin session termination แล้ว; ยังขาด audit trail และ operational notification
- [ ] ตรวจ IdP `acr`/`amr`/`auth_time` และ federated session lifetime
- [~] เพิ่ม cleanup command แล้ว; ยังขาด token-reuse incident handling และ operational metrics
- [ ] เพิ่ม notification สำหรับ auth/MFA change เป็น security best practice
- [ ] ตัดสินใจ email verification gate และ user disable/delete lifecycle
- [ ] ถ้าเปิด RBAC ให้เติม object/tenant authorization และ audit trail ต่อ generated module

### P2 — หากต้องการ target L3

- [ ] WebAuthn/passkey หรือ authenticator ที่มี phishing-resistant property
- [ ] suspicious-login และ authentication-detail-change notifications
- [ ] factor revocation เมื่อสูญหาย/ถูกขโมย
- [ ] high-value transaction step-up และ adaptive risk controls
- [ ] ทำ manual assessment/independent review ก่อนสื่อสารว่า L3-ready

## 11. Web references

เอกสารที่ใช้เป็น normative/reference หลัก ตรวจสอบล่าสุดเมื่อ 2026-09-26:

1. [OWASP ASVS 5.0 — What is the ASVS?](https://github.com/OWASP/ASVS/blob/master/5.0/en/0x03-What-is-the-ASVS.md) — ความหมายของ L1/L2/L3 และการเลือก level ตาม risk
2. [OWASP ASVS 5.0 — Assessment and Certification](https://github.com/OWASP/ASVS/blob/master/5.0/en/0x04-Assessment_and_Certification.md) — ASVS ไม่ใช่ automatic certification และต้องใช้ evidence ตาม scope
3. [OWASP ASVS 5.0.0 flat requirements](https://github.com/OWASP/ASVS/blob/master/5.0/docs_en/OWASP_Application_Security_Verification_Standard_5.0.0_en.flat.json) — requirement IDs สำหรับ V6 authentication, V7 session และ V8 authorization
4. [RFC 9700 — Best Current Practice for OAuth 2.0 Security](https://www.rfc-editor.org/rfc/rfc9700) — PKCE, authorization-code flow และ refresh-token replay prevention
5. [OWASP MFA Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Multifactor_Authentication_Cheat_Sheet.html) — re-auth, factor recovery/replacement, notification และ phishing-resistant MFA
6. [OWASP Session Management Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html) — session lifecycle, expiration, re-auth และ simultaneous sessions
7. [NIST SP 800-63B](https://pages.nist.gov/800-63-4/sp800-63b.html) — authenticator assurance, phishing resistance, recovery และ session management
8. [NIST SP 800-63B — Authenticators](https://pages.nist.gov/800-63-4/sp800-63b/authenticators/) — password, OTP, recovery code และ session secret properties
9. [OWASP Authentication Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Authentication_Cheat_Sheet.html) — authentication error handling, brute force และ credential-stuffing defenses
10. [OWASP CSRF Prevention Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Cross-Site_Request_Forgery_Prevention_Cheat_Sheet.html) — cookie-based CSRF boundary และ origin/token defenses
11. [OWASP Forgot Password Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Forgot_Password_Cheat_Sheet.html) — reset-token lifecycle, anti-enumeration และ notification
12. [OpenID Connect Core 1.0](https://openid.net/specs/openid-connect-core-1_0.html) — ID-token claims, nonce, issuer, audience และ user identity validation
13. [OWASP Authorization Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Authorization_Cheat_Sheet.html) — least privilege, deny-by-default และ object-level authorization

## 12. Definition of done ของ checklist นี้

เอกสารนี้ถือว่าเป็น living checklist ที่ใช้ได้เมื่อมีการอัปเดตทุกครั้งที่ auth template/wizard/profile เปลี่ยน และแต่ละข้อที่เป็น `[x]` มี link ไปยัง source/test หรือ deployment evidence ไม่ใช่เพียงมีชื่อ feature อยู่ใน README ค่ะ
