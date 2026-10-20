# Authentication and authorization

You choose the frontend. You also choose how clients prove who they are. Register the guards you need. Do not enable every option "just in case."

Generated acceptance exercises one supported mix: cookie sessions for HTML, opaque tokens for JSON, and short-lived JWTs. Copy those patterns, not every class in `@getstrata/core/auth`.

## Strength ladder

From most locked down for browsers, to weaker or narrower tools:

| Rank | Mechanism | Good for | Revoke? | Notes |
|------|-----------|----------|---------|-------|
| 1 | Cookie session stored in `sessions` + CSRF | HTML apps, same-site browsers | Yes. Delete the row. | Generated HTML login. Cookie name is `strata_session`. `SameSite=Lax`, `HttpOnly`. |
| 2 | Opaque access token (hashed in `api_tokens`) | SPA, mobile, machine clients | Yes. Delete or expire the row. | Send `Authorization: Bearer`. Skip CSRF. Scope with abilities. `POST /api/v1/auth/login`. |
| 3 | HMAC signed session cookie (no `sessions` row) | JSON APIs that want a signed cookie without a table | Partial. `session_valid_after` or a custom directory check. | Not generated HTML login. |
| 4 | JWT HS256 | Service-to-service, short-lived scripts | Password reset sets `session_valid_after`; JwtGuard rejects older `iat`. Also wait for `exp`. | Generated `POST /api/auth/token`. |
| 5 | HTTP Basic over TLS | Private scripts, health cron, first-party tools | Change the password. | Generated `GET /api/user` accepts Basic when that guard is registered. Never on the public internet without TLS. |
| 6 | `x-authenticated-user-id` headers | Automated tests | N/A | `GuestGuard` reads request headers only when `AUTH_DEV_HEADERS=true` exactly and `isProductionEnv()` is false. Unset, `false`, `0`, and `FALSE` leave headers off. Production (`isProductionEnv`, including staging) is always null even when the flag is true. Local `AUTH_DEV_HEADERS=true` still reads request headers. |

If you are building a browser app, start at rank 1. If you are building a SPA, use rank 2 with a tight ability list. JWT is for clients that cannot store a revocable server token and can live with expiry. Do not use JWT as an HTML cookie session.

The framework test fixture schema still uses the table name `api_token`. Generated apps use `api_tokens`.

## Named guards

`AuthManager` keeps a default guard (usually the cookie session) and extra named guards:

```typescript
auth.registerGuard("api", new DatabaseTokenGuard(container));
auth.registerGuard("jwt", new JwtGuard(container));
auth.registerGuard("basic", new BasicAuthGuard(container));
```

Generated applications do this in the generated `src/bootstrap/providers/auth.ts`. `JwtGuard` needs a directory (or container) so it can reject tokens whose `iat` is before `session_valid_after`. A `JwtGuard` without a directory returns null. It does not call `configureAbilityCatalog`.

Every generated auth provider also registers the ability checker, including cookie-only, JWT-only and development-header apps. `make:module` uses `kernel.wrapAbility` for its API writes independently of the credential selection. The existing checker reads the authenticated identity's abilities; registering it does not enable opaque-token authentication, require an API-token table, or grant new permissions. Applications still choose their own grants and resource policies.

Existing generated apps must adopt the corrected registration in `src/bootstrap/providers/auth.ts`; updating packages does not rewrite application source:

```typescript
import { createTokenAbilityChecker } from "@getstrata/core/auth/tokenAbilityChecker";
import { CORE_ABILITY_CHECKER_TOKEN } from "@getstrata/core/contracts/serviceTokens";

// In the auth provider's register({ container }) method:
container.set(CORE_ABILITY_CHECKER_TOKEN, createTokenAbilityChecker());
```

Default token abilities for HMAC sessions and test headers stay `profile:read` plus `auth:tokens:*` unless you replace the catalog:

```typescript
import { configureAbilityCatalog } from "@getstrata/core/auth/abilityCatalog";

configureAbilityCatalog({
  member: ["profile:read"],
  admin: ["*"],
  resolveForRole(role) {
    if (role === "admin") return ["*"];
    return ["profile:read"];
  },
});
```

Opaque API tokens still store their own ability list on the `api_tokens` row.

On each request `AuthManager` looks at `Authorization`:

- `Bearer` tries `api` / `access_token` / `token` / `jwt` in that order. Opaque tokens are skipped by the JWT guard (they are not three dotted parts). JWTs are skipped by the database token guard.
- `Basic` tries `basic`.
- Otherwise it tries `web` / `session` / `default` (cookies).

You can still call `auth.use("jwt")` when a route must accept only JWTs.

## CSRF

Cookie sessions need CSRF on POST, PUT, PATCH, and DELETE. HTML forms send `_token`. JSON with a cookie sends `x-csrf-token`.

`Authorization: Bearer` and `Authorization: Basic` skip CSRF only after that guard actually authenticates. A garbage Bearer plus a session cookie is not CSRF-exempt. `tests/unit/csrf.test.ts` `failed Bearer header does not skip CSRF when credentialSource is null` is the Bearer header skip when `credentialSource` is null. `tests/unit/authGuard.test.ts` `failed bearer does not fall back to a session or guest guard` is failed Bearer not resolving a session or guest user. generated security E2E `cookie login requires CSRF and ignores garbage Bearer` is garbage Bearer still requiring CSRF on POST `/login`. Successful skip is `successful bearer or basic skips CSRF`.

The API group runs CSRF on mutating anonymous and session requests. `POST /api/v1/auth/login` needs `GET /api/v1/auth/csrf` first. That GET Set-Cookies the HttpOnly CSRF cookie and returns the same token in JSON. Send it as `x-csrf-token` (or form `_token`). Bearer and Basic skip CSRF only after that guard authenticates. SCIM and SAML ACS skip CSRF by path; those authenticators still run. After cookie login, JSON logout and other session POSTs still need the token. JavaScript cannot read the CSRF cookie.

CORS allowlists `X-CSRF-Token`. When it reflects a specific origin it also sends `Access-Control-Allow-Credentials`. That does not make cross-site cookie JSON work: the CSRF cookie is `SameSite=Lax`, so a different site cannot send it on fetch. If a mutating cookie request still includes `Origin` from another site, or omits `Origin`, CSRF middleware rejects it after the token check (`Cross-site cookie requests are not allowed.`). `GET /login` and `GET /api/v1/auth/csrf` do not require Origin. ACS and `/scim/` skip CSRF by path. Inbound Stripe webhooks skip `/billing/webhooks/`. The IdP-shaped ACS e2e is same-origin fetch with `idpShapedHeaders()` Origin/Referer and HMAC RelayState, not a browser IdP POST. Cross-site SPAs stay on Bearer.

A missing CSRF token on an API route is JSON 403, not a 500.

## Abilities

Opaque tokens store an ability list. `*` means all.

Generated applications JWT mint stores `[]` abilities. JwtGuard looks up the user and rejects tokens whose `iat` is before `session_valid_after`. Opaque login tokens are stored with `[]`.

Use policies (`Policy` / `PolicyGate`) for resource authorization. That is not the same as a token ability.

### `wrapAbility` vs `wrapWebGlobalAdmin`

JSON APIs typically use `kernel.wrapAbility("products:create")` (authenticated group + ability list on the token or session). Load a row and call `wrapPolicy("products", "update", …)` or `PolicyGate.authorize` when the rule is “may this user change **this** product”.

HTML admin screens that should be limited to `users.is_admin` use `kernel.wrapWebGlobalAdmin`. That is cookie auth + verified email (when enabled) + the global-admin middleware. It does not read `products:create`. `kernel.wrapWebAbility("products:create", …)` is the HTML equivalent of `wrapAbility` when staff share an ability catalog with the API.

Mixing them on one resource is normal: public catalog `wrapWebPublicRead`, JSON writes `wrapAbility` + `ProductPolicy`, `/admin/products` `wrapWebGlobalAdmin`. Grant JSON abilities separately from `is_admin`. More app-level guidance: [BUILDING-APPS.md](./BUILDING-APPS.md).

## Email verification and password confirm

These are kernel helpers. Cookie apps generated with `--email-verification` ship `/email/verify`, a one-time hashed token plus HMAC-signed link, and a resend form. Token/JWT apps also get `POST /api/v1/auth/verify-email`.

- `FEATURE_EMAIL_VERIFICATION=true` makes `wrapWebAuthenticated` send HTML users with `emailVerifiedAt: null` to `/email/verify`.
- Fresh signup persists its account and verification-token intent in one transaction. Generated auth database timestamps use `sqlTimestamp`; MySQL DATETIME bindings must not use raw ISO wire strings. SMTP is registered with `afterCommit` from `@getstrata/core/database/transaction`, so an RLS request's outer transaction must commit before delivery. Token persistence failure rolls back signup and permits retry. SMTP failure after commit retains the account; a browser owner can sign in while unverified and request `/email/verification-notification`. This process-local callback is not durable delivery; use the SQL outbox for effects that must survive crashes. See [starter journey qualification](STARTER-JOURNEYS.md).
- `GET /email/verify` consumes the one-time token and redirects to `/login`. It does not create a session. Generated JSON and HTML verification now put purpose-scoped token consumption and the account update/immediate observers in one explicit `runInTransaction`, including SQLite/non-RLS apps. A database or observer failure rolls them back, leaving the original signed link retryable. Successful verification applies once; invalid/expired/wrong-purpose tokens retain the existing JSON 403 or HTML flash/redirect behavior. Signature and CSRF admission are unchanged. Existing apps must explicitly adopt the released verification helper/handlers; updating dependencies does not rewrite routes. This transaction does not qualify external mail delivery, link-scanner policy or email-address-change binding.
- Password reset updates the hash, sets `users.session_valid_after`, deletes `sessions` rows, and deletes `api_tokens` for that user. JwtGuard rejects JWTs issued before that watermark. Cookie sessions compare `sessions.created_at` to the watermark, not last-seen. Generated JSON and HTML reset handlers validate the new password before consuming the signed one-time token. Token consumption, hash update and credential revocation use one `runInTransaction` boundary; a database failure rolls them all back so the original link and credentials remain usable. Successful reset consumes the link once; replay cannot replace the password again. Signed-route and CSRF checks still apply. Existing generated apps must adopt the updated reset-handler/helper shape; updating a package alone does not rewrite application files.
- Sensitive HTML actions can require a fresh password-confirm cookie (`wrapWebPasswordConfirm`). MFA enroll requires that cookie.

SAML ACS verifies HMAC RelayState without a SameSite cookie so a cross-site IdP POST can succeed. Replay stores assertion IDs in `auth_saml_assertions` by default (SQL unique insert). Tests may use an in-memory store. Both drop IDs after 1 hour, which is longer than a typical assertion `NotOnOrAfter` plus `acceptedClockSkewMs` (5000). ACS also checks `profile.issuer` against `SAML_IDP_ISSUER`. Signed responses are required in production (`SAML_WANT_RESPONSE_SIGNED=false` is rejected at boot). `SAML_IDP_ISSUER` is required. JIT is skipped when `FEATURE_REGISTRATION=false`. New users and SAML JIT use `currentTenantId()`. If the account already has MFA enrolled, ACS redirects to `/login/mfa` instead of creating a session.

## Single-use MFA recovery codes

`completePasswordLogin` validates the submitted TOTP/recovery code against a user snapshot. When it returns `consumedRecoveryHash`, await `persistConsumedRecoveryHash` before creating a session/token or accepting the request. The persistence helper conditionally updates the exact validated recovery-code snapshot and requires one affected row. Stale, missing or inaccessible rows reject with the existing `UnprocessableEntityError(422, "mfa_invalid")`; database failures propagate. The helper keeps its `Promise<void>` contract, so existing awaited callers fail closed without adding a new boolean check.

Only the winning request may proceed. A competing request, including one using another code from a now-stale snapshot, must reload/authenticate again; the helper does not retry stale decisions. A rejected stale write cannot reintroduce previously consumed hashes. Hashes and plaintext recovery codes are never included in rejection details. Ordinary TOTP and non-MFA logins perform no recovery-code write. Basic authentication maps rejected claims to no authenticated user and uses the verified user identifier's RLS scope, restoring the caller's scope afterwards.

This is an atomic claim, not an atomic transaction with later credential creation or external effects. A failure after a successful claim may leave that code spent; do not restore it from an old snapshot. Published callers should retain the generated await-before-issuance ordering. This does not add TOTP replay prevention or change recovery-code generation/cryptography.

## Basic authentication within one HTTP request

`AuthManager` reuses Basic credential resolution for the same native `Request` while its Authorization and `x-mfa-code` headers remain unchanged. Middleware and controller calls to `user`, `check`, `requireUser` or `resolveWithSource` therefore do not consume a recovery proof repeatedly. Concurrent lookups on that request share the in-flight resolution. A later HTTP request always authenticates again, even with identical headers; spent recovery codes remain rejected.

Results use weak Request keys rather than a credential/global-user cache. Changing either credential header, switching authorization schemes or registering a guard invalidates reuse. Infrastructure errors are not retained, and an older failed resolution cannot remove a newer credential result. Bearer/session behavior and the `request`-omitted auth-context lookup remain unchanged. Treat an admitted Basic principal as that request's authentication snapshot; this is not cross-request caching or a revocation bypass for later requests.

## MFA setup concurrency and unreceived responses

Generated `/account/mfa` uses a typed repository conditional write against the loaded MFA enabled/secret/recovery fields and `session_valid_after`. A competing change after that snapshot produces the standard 409 conflict before any recovery-code page is returned. The trusted security payload is encrypted/hashed explicitly before this repository write; set-based writes intentionally bypass per-model observers/casts. Extensions requiring audit effects should add them to this explicit transaction rather than assuming a model hook runs. Tenant identifier scoping and the existing CSRF/password-confirmation admission remain in place.

The write and cookie/API-token/JWT revocation run in an explicit transaction, including SQLite/non-RLS apps. A revocation failure rolls the setup back. A fresh deliberate replacement remains supported; this is optimistic state protection for stale writes, not an enrollment-version token tied to the earlier GET form or a distributed lock.

Only the winning committed response shows plaintext recovery codes. If that response is lost, do not replay or store those codes in plaintext: the old session is revoked, the configured authenticator can perform a fresh login, and fresh password confirmation allows deliberate replacement. A later GET does not recover previous codes. If the authenticator is also unavailable, a separate account-recovery policy is needed; this flow does not invent one. Existing apps must explicitly adopt the released generated handler shape; updating packages does not rewrite their routes.

## JWT issuance and revocation precision

Framework-signed JWTs retain millisecond issuance precision in the NumericDate `iat` claim. RFC 7519 permits fractional NumericDates. This keeps a token issued after `session_valid_after` from appearing older because of second rounding. The guard still rejects issuance before the cutoff; equality retains the existing session-cookie comparison semantics. Expiration remains the same integer-second boundary and TTL policy. Existing integer-`iat` tokens remain supported, with their original coarse ordering; no tolerance admits tokens from before revocation.

This is wall-clock ordering, not a distributed logical revocation epoch: clock skew and two effects at the same millisecond remain operational boundaries. Consumers must accept valid fractional NumericDates. No authentication delay or custom claim is needed.

## Sessions table

Generated cookie apps store browser sessions in `sessions`. Logout deletes the current row and clears `strata_session`. That is why rank 1 is stronger than a signed cookie alone. There is no generated "sign out other devices" screen.

`APP_KEY_PREFIX` names Redis keys (`myapp:queue:default`). It does not name the HTML session cookie. Change `cookieName` in the auth provider if you want `myapp_session`.

## What not to copy from core

These exist for generic apps, tests, or framework fixtures. Generated applications do not use them as its product model:

- `GuestGuard` (dev headers)
- HMAC `SessionGuard` as the HTML login
- `MembershipService` / org membership tables (Generated apps scope rows with `users.tenant_id` when tenancy is `rls` or `column`)
- Fixture table `api_token` (generated apps use `api_tokens`)

## Environment

| Variable | Meaning |
|----------|---------|
| `SESSION_SECRET` | 32+ characters in production for HTMX cookie apps |
| `JWT_SECRET` | HS256 key. Falls back to `SESSION_SECRET` locally. Outside development (including staging) it must be set; it is not derived from the app name |
| `JWT_TTL_SECONDS` | Default 3600 |
| `AUTH_DEV_HEADERS` | `GuestGuard`: production (`isProductionEnv`, including staging) is always null. Local `AUTH_DEV_HEADERS=true` still reads request headers. |
| Identity response headers | Never set. `x-authenticated-user-id`, `x-tenant-id`, and `x-tenant-region` are not written on responses. CORS still allowlists `X-Authenticated-User-Id`, `X-Authenticated-User-Role`, and `X-Tenant-Id`. |
| `TOKEN_HASH_PEPPER` | Required in production when token auth is on |
| `API_TOKEN_DEFAULT_EXPIRY_DAYS` | Required in production when token auth is on |
| `FEATURE_MFA` | Cookie apps get `/login/mfa` and `/account/mfa`. Password login (HTML MFA, token, JWT, and Basic mint) goes through `completePasswordLogin` when the user is enrolled. Enrollment is optional. JwtGuard does not run TOTP on each request. New secrets require encryption configuration even locally. The legacy KMS key writes `enc:v1:`; the opt-in keyring supports reader-first v1 writes or explicit `enc:v2:` writes while retaining old decrypt keys. Legacy plaintext reads remain development-only without encryption configuration. See [rotation configuration](ENCRYPTION-ROTATION.md). Generated SAML ACS redirects enrolled users to `/login/mfa`. Generated `--oidc` uses the same MFA gate via `completeBrowserSsoLogin`. |
| `FEATURE_EMAIL_VERIFICATION` | Kernel redirects plus generated verify pages / one-time JSON verify |
| `FEATURE_REGISTRATION` | `false` 404s HTML and JSON register routes and blocks SAML JIT |
| `FEATURE_OAUTH` | Optional `--oauth-github` generates GitHub cookie login (`GET /auth/github`, callback, login link, JIT + MFA gate). GitHub state is `createOAuthState()` on the query string. It does not call `createOAuthStateCookie()`. Optional `--oidc` generates OIDC cookie login (`GET /auth/oidc`, callback, `oidc_pkce` cookie). The login link is hidden unless `FEATURE_OAUTH=true` and `OIDC_CLIENT_ID` / `OIDC_CLIENT_SECRET` are set; the route is 404 until then. Call `createAuthorization()` and pass the handshake to `exchangeCode()`. `getAuthorizationUrl()` throws. Loopback issuers are fetched outside production; other private hosts need `OIDC_ALLOW_PRIVATE=true` (ignored in production). Browser SSO failures are JSON, not `login.eta`. `completeBrowserSsoLogin` lowercases email. Inbound OIDC ID tokens are RS256 via JWKS. App JWTs are HS256 (`signJwt`). Multi-valued `aud` requires `azp` equal to the client id. `at_hash` is verified when present; omitted `access_token` plus `at_hash` throws. GitHub OAuth always reads `/user/emails` and throws unless a verified address exists (unverified `profile.email` is ignored). |
| `FEATURE_SAML` | Real SP via optional peer `@node-saml/node-saml`. Routes `GET /auth/saml` and `POST /auth/saml/acs` 404 when the flag is off. Requires `SAML_IDP_ISSUER`. ACS compares assertion issuer. Signed responses default on; production boot rejects `SAML_WANT_RESPONSE_SIGNED=false`. |

Production checks: [PRODUCTION.md](./PRODUCTION.md).

## Persisted account state and explicit adoption

Generated user-backed apps include `0006_account_state.ts`, model/directory fields `is_active` and `auth_version`, and the serialized issuance/SCIM protocol below. Existing apps must add the factory under their **next unused migration name**; do not overwrite migration history or regenerate over application logic:

```ts
import { createAccountStateMigration } from "@getstrata/core/auth/accountStateMigration";
import { resolveDatabaseDriver } from "@getstrata/core/database/schema";

export default createAccountStateMigration("0006_account_state", resolveDatabaseDriver(), {
  sessions: true, // only when this app has the standard database-cookie sessions table
});
```

The factory adds non-null `users.is_active = true` and `users.auth_version = 0`; `{ sessions: true }` also adds `sessions.auth_version = 0`. Existing rows retain their other values and tenant policies. Without the option, a users-only/token/JWT schema needs no sessions table. Ordinary rollback refuses to remove security state; explicit destructive development `migrate:fresh` remains supported. Administrative downgrade requires preserving account state and resetting credentials, rather than dropping columns through routine rollback. Authentication performs no implicit DDL.

**Upgrade before admission:** stop HTTP/SSO/token issuance and workers that write authentication state, back up the database, apply the additive migration, merge the generated User/auth-directory/auth-provider/auth-module/SCIM/pending-MFA shapes into the app, deploy all participating writers, then reopen admission. Do not run old issuance code alongside the new suspension protocol: an old writer can mint opaque credentials without checking status or taking the account lock. Installing a package does not rewrite application files. New generated directory readers fail closed on missing/malformed state. Pre-existing active database sessions get version zero; previously unversioned JWT/signed-session/pending-MFA/confirmation proofs require fresh issuance when epoch enforcement is enabled. Test this sequence against an upgrade fixture before deployment.

### Admission, issuance and revocation

`AuthUserRecord.is_active?: boolean` and `auth_version?: number` are optional for legacy/custom directories. Omitted metadata preserves legacy admission; explicit malformed/inactive status denies, and a configured epoch must be a non-negative safe integer. JWT and signed-session guards load current directory state and match the credential's `authVersion`. Database-cookie sessions compare their persisted version with the current account version. Opaque token/custom guards project live trusted `AuthUser.isActive` and `authVersion`; a token-carried status is not a live lookup. Expiration remains enforced. Timestamp-watermark revocation remains for legacy records without epochs; epoch-aware paths use the counter as authoritative, avoiding transaction-start timestamp ordering. Every participating security revocation must advance it; a watermark-only custom write is insufficient.

Generated `runWithLockedAuthUser` reloads the account under identified-user bypass and an explicit transaction, using `lockForUpdate` on Postgres/MySQL. SQLite uses the framework's serialized `BEGIN IMMEDIATE` write transaction and does not pretend to have row locks. Password verification and cookie/API/JWT issuance, pending MFA completion, SSO issuance and password confirmation participate in this protocol. SSO rechecks the canonical email after locking; disabled browser SSO returns JSON 403. SCIM locks the same tenant-scoped user row. Thus issuance either commits before suspension and is revoked by it, or reads the new state after suspension and refuses issuance. Already admitted requests are not cancelled globally. MFA configuration compares the admission epoch and a conditional snapshot so an old in-flight request cannot replace security state after a status transition.

`revokeUserSessions(sql, id, { incrementAuthVersion: true })` updates the timestamp watermark and increments the epoch in one UPDATE, then deletes stored sessions and (by default) API tokens. It does not open a transaction: call inside the **same transaction/account lock** as status/password changes. Real deletion errors propagate and roll everything back. Optional missing Postgres credential tables are checked without aborting the transaction; concurrent DDL failures still propagate. MySQL recognizes native `ER_NO_SUCH_TABLE`. Legacy callers need no epoch column by default. Password reset and MFA replacement in the generator opt into epoch advancement. Custom issuers and custom revocation flows must adopt the same protocol; raw `signJwt` does not acquire database locks.

### SCIM suspension and reactivation

The generated SCIM adapter accepts boolean `active` on create, PUT and PATCH. Creation defaults active; inactive creation issues no credentials. Missing status on an update retains the stored value. Each actual status transition (in either direction) persists status, increments the epoch and deletes old credentials atomically; repeating the same status leaves the epoch unchanged. Reactivation never resets the epoch or revives old credentials. Basic authentication may succeed with a fresh password/MFA proof after reactivation; old stored cookie/token/JWT and pending MFA proofs remain invalid. Suspension retains the account; deletion remains a separate generated CRUD operation. App-specific retention, orders and business policy stay in the application.

`@getstrata/core/auth/pendingMfaCookie` owns the purpose-bound pending proof, canonical identity/version parsing, ten-minute expiry, signature and secure cookie flags. The generated helper delegates to it with `sessionSecret()`. The MFA POST matches the signed epoch against the locked current account before accepting a code or issuing credentials. Password confirmations optionally carry an epoch via `createPasswordConfirmCookie(id, authVersion)`; the official confirmation middleware checks it against the admitted principal. An old confirmation cannot authorize a fresh post-reactivation session. Legacy confirmation callers without account metadata retain their previous format.

Native generated SQLite and restricted Postgres tests exercise cookie/token/JWT/Basic admission, owned RS256 OIDC/PKCE login, inactive creation, idempotent transitions, stale MFA/confirmation proofs, SQL and post-write observer rollback, tenant isolation and account-lock contention. MySQL migration/revocation regressions and generated compiler checks cover the corresponding supported boundaries. These tests do not qualify a live external IdP, every provider integration or production capacity.

Shared request-cookie parsing treats malformed percent encoding as an absent credential rather than throwing URIError. Signed-session and password-confirmation readers reuse it. This preserves existing valid cookie payloads while removing generated pending-MFA crypto duplication.


### Explicit cache privacy for authentication responses

Generated auth routes use `privateJsonResponse` from `@getstrata/core/http/response` for identity, credentials, CSRF and handled auth JSON responses. It preserves payloads, status and supplied headers/cookies, and sets `Cache-Control: private, no-store` even if a conflicting cache header was supplied. Ordinary `jsonResponse` retains its existing defaults.

Rendered auth pages explicitly select `renderer.namespace("auth", { headers: { "Cache-Control": "private, no-store" } })`. Namespace defaults are copied when the namespace is created; rendering remains explicit. Per-render headers override defaults with the same name, including replacing the complete Set-Cookie list. Other defaults survive, multiple cookies remain separate, and `renderHtmx` still adds its representation Vary fields. Applications own their public/private page policy; no controller-name inference or global successful-response policy is introduced. Explicit redirects and arbitrary native responses retain their existing contracts. Existing apps must adopt this generated shape after upgrading; installing packages alone does not rewrite auth modules.

## JSON cookie account lifecycle

API and React SPA cookie starters expose JSON registration and password recovery rather than mounting HTML auth pages. Registration (`POST /api/v1/auth/register`) returns neutral `{ ok: true }`, status 201, and does not sign in. Login sets the official session cookie. Fetch `GET /api/v1/auth/csrf`, retain its cookie and send `X-CSRF-Token` on every cookie-authenticated write. Use browser credentials for cookie requests. Authentication JSON responses are no-store.

`POST /api/v1/auth/forgot-password` sends a signed reset URL; submit `{ password }` to that exact path/query with POST. With email verification selected, submit the signed mail URL to `POST /api/v1/auth/verify-email`; an authenticated unverified owner can resend with `POST /api/v1/auth/verification-notification`. Replays and tampered signatures reject. These are JSON endpoints: a GET does not consume a token, and the client owns its forms and mail-link handling. The example React scaffold does not supply a complete account-management UI.

With MFA selected, a verified session can request a proposed `{ secret, otpauth }` through `GET /api/v1/auth/mfa`. Confirm the current password with `POST /api/v1/auth/confirm-password`, retaining the official epoch-bound confirmation cookie, then submit `{ secret, code }` to `POST /api/v1/auth/mfa`. Missing confirmation returns JSON 423; invalid proofs return 422. Enrollment shares the HTML path's conditional ORM write and transactional credential revocation, and returns `{ recoveryCodes }` once. Sign in again with `{ email, password, mfa_code }`; a missing code returns 401 `mfa_required`, and recovery codes cannot be reused. Old session/confirmation proofs cannot authorize a new enrollment after the epoch changes. Verification/registration feature flags retain their existing semantics.

HTMX and hybrid apps retain their HTML redirects/forms. No class-name inference, custom cookie format, client-issued authentication proof or separate SQL security protocol is introduced. Upgrading packages does not rewrite existing generated application files; adopt the current generated module explicitly.


### Explicit development header identities

Header starters register the published `AuthManager` and `GuestGuard`, rather than a partial generated manager. `requireUser`, named guards and credential-source handling therefore share the framework contract. Named/default `GuestGuard` resolutions retain `guest` source metadata; the name of a guard does not turn a header identity into a cookie, bearer or Basic credential. Persisted/custom session, bearer and Basic guards retain their source classification and ordering.

A non-null guest-source identity is a non-cookie development proof only when `AUTH_DEV_HEADERS` is exactly `true` and the environment is outside production/staging. Such resource writes do not need an account/CSRF endpoint. Anonymous requests, cookie sessions, disabled or malformed flags, forged source headers and production/staging guest contexts retain CSRF admission. This exemption does not authenticate an otherwise missing identity. `GuestGuard` itself continues to refuse production/staging, even when the dev flag is true.

Browser cross-origin calls carrying identity headers require a CORS preflight. Unknown origins receive no permission to send those headers; no wildcard or Origin rewriting is introduced. Production applications must select a real account/credential guard. Native generated-app regressions exercise actual ORM writes and tenant isolation on all three engines, while existing cookie/anonymous CSRF assertions remain unchanged.
