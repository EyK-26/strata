# Authentication and authorization

You choose the frontend. You also choose how clients prove who they are. Register the guards you need. Do not enable every option "just in case."

HiroApp shows the combinations that make sense for a hiring product. Copy those patterns, not every class in `@getstrata/core/auth`.

## Strength ladder

From most locked down for browsers, to weaker or narrower tools:

| Rank | Mechanism | Good for | Revoke? | Notes |
|------|-----------|----------|---------|-------|
| 1 | Cookie session stored in `sessions` + CSRF | HTML apps, same-site browsers | Yes. Delete the row. | HiroApp staff HTML. `SameSite=Lax`, `HttpOnly`. |
| 2 | Opaque access token (hashed in `api_token`) | SPA, mobile, partner jobs boards | Yes. Delete or expire the row. | Send `Authorization: Bearer`. Skip CSRF. Scope with abilities. |
| 3 | HMAC signed session cookie (no `sessions` row) | JSON APIs that want a signed cookie without a table | Partial. `session_valid_after` or a custom directory check. | Not HiroApp HTML login. |
| 4 | JWT HS256 | Service-to-service, short-lived scripts | Hard. Wait for `exp`, or keep a denylist (you build that). | HiroApp `POST /api/auth/token`. |
| 5 | HTTP Basic over TLS | Private scripts, health cron, first-party tools | Change the password. | HiroApp `GET /api/user` accepts Basic. Never on the public internet without TLS. |
| 6 | `x-authenticated-user-id` headers | Automated tests | N/A | Only when `AUTH_DEV_HEADERS=true`. Production must set `false`. |

If you are building a browser app, start at rank 1. If you are building a SPA, use rank 2 with a tight ability list. JWT is for clients that cannot store a revocable server token and can live with expiry. Do not use JWT as a portal session.

## Named guards

`AuthManager` keeps a default guard (usually the cookie session) and extra named guards:

```typescript
auth.registerGuard("api", new DatabaseTokenGuard(container));
auth.registerGuard("jwt", new JwtGuard());
auth.registerGuard("basic", new BasicAuthGuard(container));
```

Default token abilities for HMAC sessions and test headers are `profile:read` plus `auth:tokens:*`. Replace them per app:

```typescript
import { configureAbilityCatalog } from "@getstrata/core/auth/abilityCatalog";

configureAbilityCatalog({
  member: ["profile:read"],
  admin: ["*"],
  resolveForRole(role) {
    if (role === "admin") return ["*"];
    if (role === "recruiter") return ["profile:read", "integrations:ping"];
    return ["profile:read"];
  },
});
```

HiroApp does this in generated `apps/hiroapp/src/bootstrap/providers/auth.ts`. Opaque API tokens still store their own ability list on the `api_tokens` row.

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

Staff JWTs mint with `reports:export` and `profile:read`, not `*`. JWT claims are not revoked until expiry.

Use policies (`Policy` / `PolicyGate`) for resource authorization. That is not the same as a token ability.

## Email verification and password confirm

- `FEATURE_EMAIL_VERIFICATION=true` sends HTML users with `emailVerifiedAt: null` to `/email/verify`. Signed links call `markEmailVerified`.
- Sensitive HTML actions can require a fresh password-confirm cookie (`wrapWebPasswordConfirm`). HiroApp uses this on account mutations.

## Sessions table

HiroApp stores browser sessions in Postgres (`sessions`). Logout, "sign out other devices", and password change delete or invalidate rows. That is why rank 1 is stronger than a signed cookie alone.

## What not to copy from core

These exist for generic apps or tests. HiroApp does not use them as the hiring UI:

- `GuestGuard` (dev headers)
- HMAC `SessionGuard` as the HTML login
- `MembershipService` as HiroApp's department model (HiroApp uses `role_id` and departments)

## Environment

| Variable | Meaning |
|----------|---------|
| `SESSION_SECRET` | 32+ characters in production for HTMX cookie apps |
| `JWT_SECRET` | HS256 key. Falls back to `SESSION_SECRET`, then a local dev secret |
| `JWT_TTL_SECONDS` | Default 3600 |
| `AUTH_DEV_HEADERS` | Must be `false` in production |
| `TOKEN_HASH_PEPPER` | Required in production when token auth is on |
| `API_TOKEN_DEFAULT_EXPIRY_DAYS` | Required in production when token auth is on |
| `FEATURE_MFA` | Staff TOTP in HiroApp |
| `FEATURE_OAUTH_MOCK` | Local SSO button (`/auth/oauth/mock`) |

Production checks: [PRODUCTION.md](./PRODUCTION.md).
