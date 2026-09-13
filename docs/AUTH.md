# Authentication and authorization

You choose the frontend. You also choose how clients prove who they are. Register the guards you need. Do not enable every option "just in case."

Generated HiroApp (`apps/hiroapp`) is dogfood for internal end-to-end testing. It shows one working mix: cookie sessions for HTML, opaque tokens for JSON, and short-lived JWTs. Copy those patterns, not every class in `@getstrata/core/auth`.

## Strength ladder

From most locked down for browsers, to weaker or narrower tools:

| Rank | Mechanism | Good for | Revoke? | Notes |
|------|-----------|----------|---------|-------|
| 1 | Cookie session stored in `sessions` + CSRF | HTML apps, same-site browsers | Yes. Delete the row. | Generated HiroApp HTML login. Cookie name is `strata_session`. `SameSite=Lax`, `HttpOnly`. |
| 2 | Opaque access token (hashed in `api_tokens`) | SPA, mobile, machine clients | Yes. Delete or expire the row. | Send `Authorization: Bearer`. Skip CSRF. Scope with abilities. `POST /api/v1/auth/login`. |
| 3 | HMAC signed session cookie (no `sessions` row) | JSON APIs that want a signed cookie without a table | Partial. `session_valid_after` or a custom directory check. | Not HiroApp HTML login. |
| 4 | JWT HS256 | Service-to-service, short-lived scripts | Password reset sets `session_valid_after`; JwtGuard rejects older `iat`. Also wait for `exp`. | HiroApp `POST /api/auth/token`. |
| 5 | HTTP Basic over TLS | Private scripts, health cron, first-party tools | Change the password. | HiroApp `GET /api/user` accepts Basic when that guard is registered. Never on the public internet without TLS. |
| 6 | `x-authenticated-user-id` headers | Automated tests | N/A | `GuestGuard` reads request headers only when `AUTH_DEV_HEADERS=true` exactly and `isProductionEnv()` is false. Unset, `false`, `0`, and `FALSE` leave headers off. Production (`isProductionEnv`, including staging) is always null even when the flag is true. Local `AUTH_DEV_HEADERS=true` still reads request headers. |

If you are building a browser app, start at rank 1. If you are building a SPA, use rank 2 with a tight ability list. JWT is for clients that cannot store a revocable server token and can live with expiry. Do not use JWT as an HTML cookie session.

The leftover fixture schema still uses the table name `api_token`. Generated apps use `api_tokens`.

## Named guards

`AuthManager` keeps a default guard (usually the cookie session) and extra named guards:

```typescript
auth.registerGuard("api", new DatabaseTokenGuard(container));
auth.registerGuard("jwt", new JwtGuard(container));
auth.registerGuard("basic", new BasicAuthGuard(container));
```

Generated HiroApp does this in `apps/hiroapp/src/bootstrap/providers/auth.ts`. `JwtGuard` needs a directory (or container) so it can reject tokens whose `iat` is before `session_valid_after`. A `JwtGuard` without a directory returns null. It does not call `configureAbilityCatalog`. Default token abilities for HMAC sessions and test headers stay `profile:read` plus `auth:tokens:*` unless you replace the catalog:

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

`Authorization: Bearer` and `Authorization: Basic` skip CSRF only after that guard actually authenticates. A garbage Bearer plus a session cookie is not CSRF-exempt. `tests/unit/csrf.test.ts` `failed Bearer header does not skip CSRF when credentialSource is null` is the Bearer header skip when `credentialSource` is null. `tests/unit/authGuard.test.ts` `failed bearer does not fall back to a session or guest guard` is failed Bearer not resolving a session or guest user. HiroApp e2e `cookie login requires CSRF and ignores garbage Bearer` is garbage Bearer still requiring CSRF on POST `/login`. Successful skip is `successful bearer or basic skips CSRF`.

The API group runs CSRF on mutating guest and session requests. `POST /api/v1/auth/login` needs `GET /api/v1/auth/csrf` first. That GET Set-Cookies the HttpOnly CSRF cookie and returns the same token in JSON. Send it as `x-csrf-token` (or form `_token`). Bearer and Basic skip CSRF only after that guard authenticates. SCIM and SAML ACS skip CSRF by path; those authenticators still run. After cookie login, JSON logout and other session POSTs still need the token. JavaScript cannot read the CSRF cookie.

CORS allowlists `X-CSRF-Token`. When it reflects a specific origin it also sends `Access-Control-Allow-Credentials`. That does not make cross-site cookie JSON work: the CSRF cookie is `SameSite=Lax`, so a different site cannot send it on fetch. If a mutating cookie request still includes `Origin` from another site, or omits `Origin`, CSRF middleware rejects it after the token check (`Cross-site cookie requests are not allowed.`). `GET /login` and `GET /api/v1/auth/csrf` do not require Origin. ACS and `/scim/` skip CSRF by path. The IdP-shaped ACS e2e is same-origin fetch with `idpShapedHeaders()` Origin/Referer and HMAC RelayState, not a browser IdP POST. Cross-site SPAs stay on Bearer.

A missing CSRF token on an API route is JSON 403, not a 500.

## Abilities

Opaque tokens store an ability list. `*` means all.

Generated HiroApp JWT mint stores `[]` abilities. JwtGuard looks up the user and rejects tokens whose `iat` is before `session_valid_after`. Opaque login tokens are stored with `[]`.

Use policies (`Policy` / `PolicyGate`) for resource authorization. That is not the same as a token ability.

## Email verification and password confirm

These are kernel helpers. Cookie apps generated with `--email-verification` ship `/email/verify`, a one-time hashed token plus HMAC-signed link, and a resend form. Token/JWT apps also get `POST /api/v1/auth/verify-email`.

- `FEATURE_EMAIL_VERIFICATION=true` makes `wrapWebAuthenticated` send HTML users with `emailVerifiedAt: null` to `/email/verify`.
- `GET /email/verify` consumes the one-time token and redirects to `/login`. It does not create a session.
- Password reset updates the hash, sets `users.session_valid_after`, deletes `sessions` rows, and deletes `api_tokens` for that user. JwtGuard rejects JWTs issued before that watermark. Cookie sessions compare `sessions.created_at` to the watermark, not last-seen.
- Sensitive HTML actions can require a fresh password-confirm cookie (`wrapWebPasswordConfirm`). MFA enroll requires that cookie.

SAML ACS verifies HMAC RelayState without a SameSite cookie so a cross-site IdP POST can succeed. Replay stores assertion IDs in `auth_saml_assertions` by default (SQL unique insert). Tests may use an in-memory store. Both drop IDs after 1 hour, which is longer than a typical assertion `NotOnOrAfter` plus `acceptedClockSkewMs` (5000). ACS also checks `profile.issuer` against `SAML_IDP_ISSUER`. Signed responses are required in production (`SAML_WANT_RESPONSE_SIGNED=false` is rejected at boot). `SAML_IDP_ISSUER` is required. JIT is skipped when `FEATURE_REGISTRATION=false`. New users and SAML JIT use `currentTenantId()`. If the account already has MFA enrolled, ACS redirects to `/login/mfa` instead of creating a session.

## Sessions table

Generated cookie apps store browser sessions in `sessions`. Logout deletes the current row and clears `strata_session`. That is why rank 1 is stronger than a signed cookie alone. There is no generated "sign out other devices" screen.

`APP_KEY_PREFIX` names Redis keys (`hiroapp:queue:default`). It does not name the HTML session cookie. Change `cookieName` in the auth provider if you want `hiroapp_session`.

## What not to copy from core

These exist for generic apps, tests, or the leftover fixture. Generated HiroApp does not use them as its product model:

- `GuestGuard` (dev headers)
- HMAC `SessionGuard` as the HTML login
- `MembershipService` / org membership tables (HiroApp scopes rows with `users.tenant_id` when tenancy is `rls` or `column`)
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
| `FEATURE_MFA` | Cookie apps get `/login/mfa` and `/account/mfa`. Password login (HTML MFA, token, JWT, and Basic mint) goes through `completePasswordLogin` when the user is enrolled. Enrollment is optional. JwtGuard does not run TOTP on each request. Secrets are `enc:v1:` when a KMS key is set or in production. Local without a key may still return plaintext. Generated SAML ACS redirects enrolled users to `/login/mfa`. There is no generated OIDC cookie login. |
| `FEATURE_EMAIL_VERIFICATION` | Kernel redirects plus generated verify pages / one-time JSON verify |
| `FEATURE_REGISTRATION` | `false` 404s HTML and JSON register routes and blocks SAML JIT |
| `FEATURE_OAUTH` | OIDC uses `createAuthorization()` plus a PKCE handshake. Inbound OIDC ID tokens are RS256 via JWKS. App JWTs are HS256 (`signJwt`). Multi-valued `aud` requires `azp` equal to the client id. `at_hash` is verified when present; omitted `access_token` plus `at_hash` throws. GitHub OAuth always reads `/user/emails` and throws unless a verified address exists (unverified `profile.email` is ignored). |
| `FEATURE_SAML` | Real SP via optional peer `@node-saml/node-saml`. Routes `GET /auth/saml` and `POST /auth/saml/acs` 404 when the flag is off. Requires `SAML_IDP_ISSUER`. ACS compares assertion issuer. Signed responses default on; production boot rejects `SAML_WANT_RESPONSE_SIGNED=false`. |

Production checks: [PRODUCTION.md](./PRODUCTION.md).
