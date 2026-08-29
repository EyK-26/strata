# Sibling HTMX apps

Published `@getstrata/core` and `@getstrata/bootstrap` support Laravel.com-style **server-HTMX** apps (Eta views, cookie sessions, no API tokens / SCIM / OAuth / org membership) without vendoring framework code.

WorkHub stays the in-monorepo reference app. Defaults still match WorkHub (`workhub_session`, `workhub_csrf`, HMAC `SessionGuard`, WorkHub production secret checks when API tokens are configured).

Use `@getstrata/cli` (`strata dev|start|migrate|migrate:fresh|run`). Do not invent a private CLI. Import subpaths, not the root `@getstrata/core` barrel.

## CookieSessionStore guard

HMAC `SessionGuard` (`@getstrata/core/auth/sessionGuard`) is for WorkHub API/token apps. It reads `workhub_session` (override with `SESSION_COOKIE_NAME`) and loads the user through an `AuthUserDirectory`.

Sibling HTMX apps should bind `CookieSessionStore` + the published adapter:

```typescript
import { CORE_AUTH_TOKEN } from "@getstrata/bootstrap/config";
import { createCookieSessionAuthManager } from "@getstrata/bootstrap/web/session";
import { bindBunSql, createBunSqlPool } from "@getstrata/core/database/bunSql";

const sql = createBunSqlPool({ url: process.env.DATABASE_URL ?? "" });
bindBunSql(sql);

container.set(
  CORE_AUTH_TOKEN,
  createCookieSessionAuthManager({
    secret: process.env.SESSION_SECRET ?? "",
    cookieName: process.env.SESSION_COOKIE_NAME ?? "strata_session",
    mapUser: (user) => ({
      id: user.id,
      role: user.is_admin ? "admin" : user.learn_subscriber ? "subscriber" : "member",
    }),
  }),
);
```

`createCookieSessionAuthManager` returns a `CookieSessionAuthManager` with `signIn` / `signOut` and `signInRedirect` / `signOutRedirect`. Controllers should not talk to `CookieSessionStore` for cookie headers.

Omit `sql` so the store reads the client from `bindDatabaseConnection()` / the default pool on every call. Tests can call `resetBoundDatabaseConnection()` after `closeDatabase()` without a local auth facade.

WorkHub ships `sessions` (`0031_create_sessions`: `id` text PK, `user_id` → `users` cascade, `expires_at`) so `CookieSessionStore.create` / `read` / `destroy` can run against the same Postgres as HMAC login. WorkHub HTMX login still uses HMAC `workhub_session` — do not swap it onto `CookieSessionStore` without rewriting every web session test.

The default session SELECT still reads `learn_subscriber` / `is_admin` from `users`. WorkHub has `role` instead. Pass `loadSessionUser` (WorkHub’s `loadWorkhubSessionUser` maps `role === "admin"` and `revealEmail`) to keep that query in the app:

```typescript
import {
  loadWorkhubSessionUser,
  mapWorkhubSessionUser,
} from "../modules/user/loadWorkhubSessionUser";

createCookieSessionAuthManager({
  secret: process.env.SESSION_SECRET ?? "",
  loadSessionUser: loadWorkhubSessionUser,
  mapUser: mapWorkhubSessionUser,
});
```

Sibling apps with a different `users` schema keep their own SELECT:

```typescript
createCookieSessionAuthManager({
  secret: process.env.SESSION_SECRET ?? "",
  loadSessionUser: async (sql, sessionId) => {
    const rows = await sql.unsafe(
      `SELECT s.user_id AS id, u.name, u.email
       FROM sessions s JOIN users u ON u.id = s.user_id
       WHERE s.id = $1 AND s.expires_at > NOW()`,
      [sessionId],
    );
    return rows[0] ?? null;
  },
  mapUser: (user) => ({ id: user.id, role: "member" }),
});
```

Cookie names:

| Cookie | Default | Override |
|--------|---------|----------|
| HMAC session (`SessionGuard`) | `workhub_session` | `SESSION_COOKIE_NAME` |
| CSRF | `workhub_csrf` | `CSRF_COOKIE_NAME` |
| Flash | `workhub_flash` | `FLASH_COOKIE_NAME` |
| Redis cache / queue / throttle keys | `workhub:` | `APP_KEY_PREFIX` |
| SMTP EHLO host | `workhub.local` | `MAIL_EHLO` |
| SIEM `event_type` / CEF vendor | `workhub.audit` / `WorkHub` | `SIEM_EVENT_TYPE` / `APP_NAME` |
| GitHub OAuth user-agent | `workhub` | `APP_USER_AGENT` |
| OTEL `service.name` | `workhub-api` | `OTEL_SERVICE_NAME` |
| Webhook HMAC header | `x-workhub-signature` | `WEBHOOK_SIGNATURE_HEADER` |
| OpenAPI title / SDK class | `WorkHub API` / `WorkHubClient` | `APP_NAME` / `APP_SDK_CLASS` |
| App URL / API prefix / env | `http://localhost:3000` / `/api/v1` / `local` | `APP_URL` / `API_PREFIX` / `APP_ENV` |
| Frontend mode | `api` | `FRONTEND_MODE` (`server-htmx` / `spa-react`) via `@getstrata/core/runtime/frontendMode` |
| Queue driver / retries | `sync` / 3 / 1000ms | `QUEUE_DRIVER` / `QUEUE_MAX_ATTEMPTS` / `QUEUE_BACKOFF_MS` |
| CORS origins | `*` | `CORS_ALLOWED_ORIGINS` |
| Upload size / MIME allowlist | 5MB / common docs+images | `MAX_UPLOAD_BYTES` |
| `CookieSessionStore` | `strata_session` | constructor `cookieName` |

`kernel.wrapWebAuthenticated` / `wrapWebGlobalAdmin` work with this `AuthManager`. Do not bake WorkHub’s ability catalog into the cookie-session path.

## Ability checker vs user directory

`CORE_TOKEN_SERVICE_TOKEN` (`core.tokenService`) used to mean both `AbilityChecker` and `AuthUserDirectory`. Bind them separately:

| Token | Type | Used by |
|-------|------|---------|
| `CORE_ABILITY_CHECKER_TOKEN` | `AbilityChecker` (`tokenCan` / `requireAbility`) | `HttpKernel.wrapAbility` / `wrapWebAbility` |
| `CORE_AUTH_USER_DIRECTORY_TOKEN` | `AuthUserDirectory` (`findByIdOrThrow`, `resolveUserFromToken`) | HMAC `SessionGuard`, `DatabaseTokenGuard`, `resolveWebLayoutData` |
| `CORE_TOKEN_SERVICE_TOKEN` | compatibility | Used only when the value actually matches the requested type |

WorkHub’s `TokenService` is bound to all three.

`resolveWebLayoutData` does not assume WorkHub’s directory. `EtaViewEngine` passes the current `Request` (from `render(..., { request })` or request ALS) into the layout-data resolver. Configure sibling templates with:

```typescript
import { configureWebLayoutData } from "@getstrata/core/view";

configureWebLayoutData({
  userKey: "currentUser",
  loadUser: async (_container, request) => {
    if (!request) {
      return null;
    }
    const user = await sessionStore.read(request);
    return user ? { ...user, role: user.is_admin ? "admin" : "member" } : null;
  },
});
```

Layouts receive `{ currentUser, csrfToken, flash, cspNonce }`. Put `nonce="<%= it.cspNonce %>"` on inline CSRF helpers and set HTMX `inlineStyleNonce` so indicator CSS works without `'unsafe-inline'` on `script-src`.

Use `temporarySignedUrl()` / `hasValidSignature()` from `@getstrata/core/http/signedUrl` for attachment downloads, password reset, and email verification. HMAC uses `SIGNED_URL_SECRET` or `SESSION_SECRET`. Gate routes with `createValidateSignatureMiddleware()` or `kernel.wrapSigned()` (Laravel `signed` middleware). WorkHub applies it to `/reset-password` and `/verify-email`. Markdown mail goes through `Bun.markdown.html()` plus `sanitizeMailHtml`.

TOTP helpers live on `@getstrata/core/security/totp`: `generateTotpSecret()`, `buildOtpauthUrl()`, `generateTotp()`, `verifyTotp()`. WorkHub’s `/account` page dogfoods MFA setup/confirm/disable, API token create/revoke, GDPR JSON export (`GET /account/export`), and password-confirmed account deletion. Login only enforces MFA when `FEATURE_MFA=true`. Organization show dogfoods member add/remove and role updates (`POST /organizations/:id/members/:userId/role`; API is `PATCH /organizations/:id/members/:userId`). `/login` lists registered OAuth/SAML providers; `GET /oauth/:provider/callback` sets HMAC `workhub_session` via `authenticateOAuth` (no API token). The JSON callback at `/api/v1/auth/oauth/:provider/callback` still issues a bearer token. `GET/POST /register` (`FEATURE_REGISTRATION`, default on) creates a member with `registerWithPassword`, provisions a Jetstream-style personal workspace (`{name}'s workspace`, slug `personal-{userId}`, owner membership without requiring `currentAuthUser()`), and sets `workhub_session`. HTML register without verification redirects to `/organizations/{id}`. When `FEATURE_EMAIL_VERIFICATION=true`, it still creates the workspace, sends a verify link, keeps the session, and redirects to `/email/verify`. `wrapWebAuthenticated` / `wrapWebAbility` apply Laravel `verified` in that mode (`emailVerifiedAt === null` → `/email/verify`; JSON 403). Logout and `/email/verify` use `wrapWebAuthenticatedAllowUnverified`. POST `/register` uses `wrapWebRegister`; POST `/login`, `/forgot-password`, and `/email/verification-notification` use `wrapWebLogin` so throttle 429s are HTML forms (do not also wrap with `wrapWeb`). GET `/login`, `/register`, and `/forgot-password` use `wrapWebGuest` (Laravel `guest`) so a signed-in verified session redirects to `/organizations` (unverified → `/email/verify`). SPA/API clients use `POST /api/v1/auth/register` (`wrapRegister`) which returns a bearer token unless email verification is required. `POST /api/v1/auth/forgot-password` and `POST /api/v1/auth/reset-password` are the JSON Fortify equivalents (reset body is `{ email, token, password, password_confirmation }`). `POST /api/v1/auth/email/verification-notification` (`{ email }`) is the JSON equivalent of HTML `/email/verification-notification` and always returns a generic success message.

`createRequireAbilityMiddleware` still returns JSON `{ error }` for API clients. When `FRONTEND_MODE=server-htmx` and the request prefers HTML, it rethrows `ForbiddenError` so `wrapWeb` can render the styled 403 page.

Public HTML show pages should look up the model in the controller. `wrapSecuredRouteModelByKey` is safe on HTML if someone still uses it: a missing slug is a styled 404, and GET ETags are skipped for HTML / composite objects unless you pass `etag: true`.

## Content-Security-Policy

`createSecurityHeadersMiddleware({ directives })` or `configureContentSecurityPolicy({ directives })` **extends** the HTMX baseline (YouTube/Vimeo `frame-src`, `media-src 'self' https:`, `img-src 'self' data: https:`, HTMX indicator style hash + per-request nonce). JSON/API responses stay `default-src 'none'`. Do not add `'unsafe-inline'` to `script-src`.

## HTML errors

`configureWebErrorView` / WorkHub’s view provider render `errors/not-found.eta`, `errors/forbidden.eta`, and `errors/error.eta` through the same Eta layout as success pages. Unknown `createWebServer` routes use that chrome (or a styled kernel fallback with `/assets/app.css`). Status codes stay 404/403/500; production 5xx messages do not leak stacks.

`wrapWebAuthenticated` login redirects keep `pathname + search` after a same-origin safe-path check (`/forum?page=2` → `/login?redirect=%2Fforum%3Fpage%3D2`).

Apps that do not have orgs should not call `configureMembershipLookup`.

`createRoutes` / `createWebRoutes` / `schedule` stay WorkHub-oriented. Sibling HTMX apps should use `buildWebModuleRoutes` (optionally `seedRoutes: createHealthRoutes(deps, { pingOnHealth: true })`).

## Bound-pool health

`checkDatabase()` / `createHealthRoutes()` ping the client already registered with `bindDatabaseConnection()` (then `registerDefaultDatabasePool`). They do not open WorkHub’s private `connectionHolder`. `bindBunSql(sql)` does both registrations. `@getstrata/core/database/boundConnection` exports `getBoundDatabaseConnection` and `resetBoundDatabaseConnection` from the published JS entry.

`GET /health` stays `{ status: "ok" }` unless you pass `{ pingOnHealth: true }`. `GET /ready` always checks the database (and Redis when `REDIS_URL` is set). Extra JSON fields are merged via `{ extra }`.

## RSS and throttle test seams

Podcast RSS can use `rssResponse(body)` or `xmlResponse(body, { contentType: "application/rss+xml" })`. Nested HTTP tests that share a kernel should call `resetMemoryThrottleForTests()` so in-memory throttle buckets do not leak.

## Feature-gated `assertProductionSecrets`

WorkHub still calls this from `App.serve()` / `queue:work`. `createAppContext()` does not. A production HTMX app with `DATABASE_URL`, `SESSION_SECRET` (32+ chars), `AUTH_DEV_HEADERS=false`, and feature flags off can call it without WorkHub API tokens.

See [PRODUCTION.md](./PRODUCTION.md) for the matrix.

## Facades types

`import { cache, mail, events, queue, auth } from "@getstrata/core/facades"` typechecks. CI verifies every `exports.*.types` path exists after `bun run build` in the published packages.
