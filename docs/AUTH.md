# Authentication and authorization

You choose the frontend. You also choose how clients prove who they are. Register the guards you need. Do not enable every option "just in case."

Generated HiroApp (`apps/hiroapp`) shows one working mix: cookie sessions for HTML, opaque tokens for JSON, and short-lived JWTs. Copy those patterns, not every class in `@getstrata/core/auth`.

## Strength ladder

From most locked down for browsers, to weaker or narrower tools:

| Rank | Mechanism | Good for | Revoke? | Notes |
|------|-----------|----------|---------|-------|
| 1 | Cookie session stored in `sessions` + CSRF | HTML apps, same-site browsers | Yes. Delete the row. | Generated HiroApp HTML login. Cookie name is `strata_session`. `SameSite=Lax`, `HttpOnly`. |
| 2 | Opaque access token (hashed in `api_tokens`) | SPA, mobile, machine clients | Yes. Delete or expire the row. | Send `Authorization: Bearer`. Skip CSRF. Scope with abilities. `POST /api/v1/auth/login`. |
| 3 | HMAC signed session cookie (no `sessions` row) | JSON APIs that want a signed cookie without a table | Partial. `session_valid_after` or a custom directory check. | Not HiroApp HTML login. |
| 4 | JWT HS256 | Service-to-service, short-lived scripts | Hard. Wait for `exp`, or keep a denylist (you build that). | HiroApp `POST /api/auth/token`. |
| 5 | HTTP Basic over TLS | Private scripts, health cron, first-party tools | Change the password. | HiroApp `GET /api/user` accepts Basic when that guard is registered. Never on the public internet without TLS. |
| 6 | `x-authenticated-user-id` headers | Automated tests | N/A | Only when `AUTH_DEV_HEADERS=true`. Production must set `false`. |

If you are building a browser app, start at rank 1. If you are building a SPA, use rank 2 with a tight ability list. JWT is for clients that cannot store a revocable server token and can live with expiry. Do not use JWT as an HTML cookie session.

The leftover fixture schema still uses the table name `api_token`. Generated apps use `api_tokens`.

## Named guards

`AuthManager` keeps a default guard (usually the cookie session) and extra named guards:

```typescript
auth.registerGuard("api", new DatabaseTokenGuard(container));
auth.registerGuard("jwt", new JwtGuard());
auth.registerGuard("basic", new BasicAuthGuard(container));
```

Generated HiroApp does this in `apps/hiroapp/src/bootstrap/providers/auth.ts`. It does not call `configureAbilityCatalog`. Default token abilities for HMAC sessions and test headers stay `profile:read` plus `auth:tokens:*` unless you replace the catalog:

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

`Authorization: Bearer` and `Authorization: Basic` skip CSRF. Those clients are not using the cookie as the credential.

## Abilities

Opaque tokens store an ability list. `*` means all.

Generated HiroApp JWT mint uses `profile:read` plus `reports:export` for admin, and `profile:read` for member. JWT claims are not revoked until expiry. Opaque login tokens are stored with `["profile:read"]`.

Use policies (`Policy` / `PolicyGate`) for resource authorization. That is not the same as a token ability.

## Email verification and password confirm

These are kernel helpers. Cookie apps generated with `--email-verification` ship `/email/verify`, a signed-link handler, and a resend form. Token/JWT apps also get `POST /api/v1/auth/verify-email`.

- `FEATURE_EMAIL_VERIFICATION=true` makes `wrapWebAuthenticated` send HTML users with `emailVerifiedAt: null` to `/email/verify`.
- Sensitive HTML actions can require a fresh password-confirm cookie (`wrapWebPasswordConfirm`). Add that wrap when you ship password-change HTML.

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
| `JWT_SECRET` | HS256 key. Falls back to `SESSION_SECRET`, then a local dev secret |
| `JWT_TTL_SECONDS` | Default 3600 |
| `AUTH_DEV_HEADERS` | Must be `false` in production |
| `TOKEN_HASH_PEPPER` | Required in production when token auth is on |
| `API_TOKEN_DEFAULT_EXPIRY_DAYS` | Required in production when token auth is on |
| `FEATURE_MFA` | Cookie apps get `/login/mfa` and `/account/mfa`. Core TOTP helpers live in `@getstrata/core/security/totp` |
| `FEATURE_EMAIL_VERIFICATION` | Kernel redirects plus generated verify pages / signed JSON verify |
| `FEATURE_OAUTH` | Real OAuth/OIDC. Generated HiroApp does not ship `/auth/oauth/mock` |

Production checks: [PRODUCTION.md](./PRODUCTION.md).
