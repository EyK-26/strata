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
| 6 | `x-authenticated-user-id` headers | Automated tests | N/A | Only when `AUTH_DEV_HEADERS=true` exactly. Unset, `false`, `0`, and `FALSE` leave headers off. Production must set `false`. |

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

`Authorization: Bearer` and `Authorization: Basic` skip CSRF only after that guard actually authenticates. A garbage Bearer plus a session cookie is not CSRF-exempt.

The API group runs CSRF for session-mutating requests. Guest JSON login (`POST /api/v1/auth/login` without a session) relies on SameSite=Lax plus CORS, not double-submit. After cookie login, JSON logout and other session POSTs need `_token` or `x-csrf-token`. `GET /api/v1/auth/csrf` Set-Cookies the HttpOnly CSRF cookie. JavaScript cannot read that cookie; send the JSON token in the header.

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

SAML ACS verifies HMAC RelayState without a SameSite cookie so a cross-site IdP POST can succeed. Replay stores assertion IDs in `auth_saml_assertions`. Signed responses are required (`SAML_WANT_RESPONSE_SIGNED=false` opts out). `SAML_IDP_ISSUER` is required. JIT is skipped when `FEATURE_REGISTRATION=false`. New users and SAML JIT use `currentTenantId()`.

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
| `AUTH_DEV_HEADERS` | Must be `false` in production |
| `TOKEN_HASH_PEPPER` | Required in production when token auth is on |
| `API_TOKEN_DEFAULT_EXPIRY_DAYS` | Required in production when token auth is on |
| `FEATURE_MFA` | Cookie apps get `/login/mfa` and `/account/mfa`. Password login (HTML MFA, token, JWT, Basic) goes through `completePasswordLogin` when the user is enrolled. Does not force enrollment. Requires `KMS_ENCRYPTION_KEY` to store TOTP secrets. SAML and OIDC skip MFA (SSO). |
| `FEATURE_EMAIL_VERIFICATION` | Kernel redirects plus generated verify pages / one-time JSON verify |
| `FEATURE_REGISTRATION` | `false` 404s HTML and JSON register routes and blocks SAML JIT |
| `FEATURE_OAUTH` | OIDC uses `createAuthorization()` plus a PKCE handshake. ID tokens are RS256 via JWKS. GitHub OAuth reads `/user/emails` when the profile omits email and rejects a missing verified address. |
| `FEATURE_SAML` | Real SP via optional peer `@node-saml/node-saml`. Routes `GET /auth/saml` and `POST /auth/saml/acs` 404 when the flag is off. Requires `SAML_IDP_ISSUER`. Signed responses default on. |

Production checks: [PRODUCTION.md](./PRODUCTION.md).
