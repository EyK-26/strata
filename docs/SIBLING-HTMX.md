# Sibling HTMX apps

Published `@getstrata/core` and `@getstrata/bootstrap` support Laravel.com-style **server-HTMX** apps (Eta views, cookie sessions, no API tokens / SCIM / OAuth / org membership) without vendoring framework code.

WorkHub stays the in-monorepo reference app. Defaults still match WorkHub (`workhub_session`, `workhub_csrf`, HMAC `SessionGuard`, WorkHub production secret checks when API tokens are configured).

Use `@getstrata/cli` (`strata dev|start|migrate|migrate:fresh|run`). Do not invent a private CLI. Import subpaths, not the root `@getstrata/core` barrel.

## CookieSessionStore guard

HMAC `SessionGuard` (`@getstrata/core/auth/sessionGuard`) is for WorkHub API/token apps. It reads `${APP_KEY_PREFIX}_session` (default `workhub_session`; override with `SESSION_COOKIE_NAME`) and loads the user through an `AuthUserDirectory`. `appCookieName()` / `appDevSecret()` on `@getstrata/core/runtime/appKeyPrefix` derive cookie names and local secret fallbacks from the same prefix.

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

WorkHub ships `sessions` (`0031_create_sessions`: `id` text PK, `user_id` → `users` cascade, `expires_at`) so `CookieSessionStore.create` / `read` / `destroy` can run against the same Postgres as HMAC login. WorkHub HTMX login still uses HMAC `workhub_session` — do not swap it onto `CookieSessionStore` without rewriting every web session test. HMAC login now dual-writes a `sessions` row so Jetstream browser-session lists work without changing the cookie format.

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
| HMAC session (`SessionGuard`) | `${APP_KEY_PREFIX}_session` (`workhub_session`) | `SESSION_COOKIE_NAME` |
| CSRF | `${APP_KEY_PREFIX}_csrf` | `CSRF_COOKIE_NAME` |
| Flash | `${APP_KEY_PREFIX}_flash` | `FLASH_COOKIE_NAME` |
| Password confirm | `${APP_KEY_PREFIX}_password_confirmed` | `PASSWORD_CONFIRM_COOKIE_NAME` |
| MFA pending | `${APP_KEY_PREFIX}_mfa_pending` | `MFA_CHALLENGE_COOKIE_NAME` |
| Intended URL | `${APP_KEY_PREFIX}_intended` | `INTENDED_URL_COOKIE_NAME` |
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

Use `temporarySignedUrl()` / `hasValidSignature()` from `@getstrata/core/http/signedUrl` for attachment downloads, password reset, and email verification. HMAC uses `SIGNED_URL_SECRET` or `SESSION_SECRET`. Gate routes with `createValidateSignatureMiddleware()` or `kernel.wrapSigned()` (Laravel `signed` middleware). WorkHub applies it to `/reset-password` and `/verify-email`. Markdown mail goes through `Bun.markdown.html()` plus `sanitizeMailHtml`. Reset, verify, and invitation subjects/footers use `appDisplayName()` (`APP_NAME`, default `WorkHub`). Seeded welcome notifications use the same display name. `buildOtpauthUrl()` and the `strata tinker` banner use the same display name.

TOTP helpers live on `@getstrata/core/security/totp`: `generateTotpSecret()`, `buildOtpauthUrl()`, `generateTotp()`, `verifyTotp()`. Recovery codes live on `@getstrata/core/security/recoveryCodes`. WorkHub’s `/account` page shows the current team (`#current-team`) and Jetstream team invitations (`#team-invitations`; HTML `POST /account/invitations/:id/accept` joins without the mail token when the session email matches and sets current team; `POST /account/invitations/:id/decline` removes it; JSON is `GET /users/me/invitations`, `POST /users/me/invitations/:id/accept`, `DELETE /users/me/invitations/:id`) and dogfoods Fortify-style profile updates (`POST /account/profile` name/email; JSON is `PATCH /users/me` `{ name, email }`; email change + `FEATURE_EMAIL_VERIFICATION=true` clears `email_verified_at` and sends a verify link) and password updates (`POST /account/password`; JSON is `PUT /users/me/password` `{ current_password, password, password_confirmation }`; both revoke other API tokens). JSON `POST /users/me/logout-other-devices` / HTML `POST /account/logout-other-devices` are Jetstream logout-other-devices (password required; keeps the current bearer `tokenId` when present; sets `users.session_valid_after` so older HMAC `workhub_session` cookies fail `SessionGuard`). HTML login, register, OAuth, MFA complete, password change, and logout-other-devices also write a `sessions` row (`0037_add_session_browser_metadata`: user agent, IP, last active) keyed by `sha256(hmac:userId:issuedAt)` so `/account` `#browser-sessions` can mark This device. Logout and account delete remove that row; logout-other-devices deletes the other rows. `createSessionCookieDetails()` on `@getstrata/core/auth/sessionCookie` returns the issued-at/TTL used for that key. HTML password change and logout-other-devices re-issue the current session cookie. `readSession()` / `isSessionInvalidated()` live on `@getstrata/core/auth/sessionCookie`. JSON `POST /users/me/photo` (multipart field `photo`) / `GET /users/me/photo` / `DELETE /users/me/photo` and HTML `POST /account/photo` / `GET /account/photo` / `POST /account/photo/delete` are Jetstream profile photos (`Bun.Image` resize via `StorageManager`, path on `users.profile_photo_path`; `toUserResource()` stays name/email/role). JSON `POST /users/me/confirm-password` / `GET /users/me/confirmed-password-status` are the Fortify confirm-password APIs (`workhub_password_confirmed`), MFA setup/confirm (shows one-time recovery codes), regenerate (`POST /account/mfa/recovery-codes`), disable, API token create/revoke (HTML ability checkboxes `ability:<name>`; grants are scoped to the session/token; JSON `DELETE /auth/tokens/:id` is `auth:tokens:delete`, now on `MEMBER_ABILITIES`), GDPR JSON export (`GET /account/export` via Laravel `password.confirm`), and password-confirmed account deletion (`POST /account/delete`, same gate). Login accepts an optional TOTP or single-use `abcd-efgh` recovery code when `FEATURE_MFA=true`. Omitting the code sets HMAC `workhub_mfa_pending` (`MFA_CHALLENGE_TTL_SECONDS`, default 600s) and redirects to Fortify `/two-factor-challenge`. JSON `POST /auth/login` can send `mfa_code` on the same request or, if missing, returns 401 `{ two_factor: true, mfa_pending }` plus `workhub_mfa_pending`. Complete with Fortify `POST /auth/two-factor-challenge` (`code`, `mfa_code`, or `recovery_code`, optional `mfa_pending`). Bearer MFA setup is `POST /users/me/mfa`, `POST /users/me/mfa/confirm`, `POST /users/me/mfa/recovery-codes`, and `DELETE /users/me/mfa`. `GET/POST /confirm-password` sets HMAC `workhub_password_confirmed` (`PASSWORD_CONFIRM_TIMEOUT`, default 10800s). `HttpKernel.wrapWebPasswordConfirm()` redirects HTML to `/confirm-password?redirect=` (JSON 423). Do not wrap the confirm form itself with `wrapWebPasswordConfirm`. Logout and account delete clear the confirmation cookie. Login only enforces MFA when `FEATURE_MFA=true`. Organization show dogfoods member add/remove, role updates (`POST /organizations/:id/members/:userId/role`; API is `PATCH /organizations/:id/members/:userId`), Jetstream leave-team (`POST /organizations/:id/members/:userId/leave` or JSON `DELETE /organizations/:id/members/:userId` for self; last owner and `personal-{userId}` cannot leave; leaving clears `current_organization_id`), and Jetstream invitations (HTML `POST /organizations/:id/members` always emails a signed `GET /invitations/accept` link, including for existing accounts; JSON `POST /organizations/:id/members` `{ user_id }` still adds immediately; JSON invitations are `POST /organizations/:id/invitations`; resend is `POST /organizations/:id/invitations/:invitationId/resend` (HTML is the same path; rotates the token and extends expiry); register with the invited email auto-joins; a signed `GET /invitations/accept` from the mail (guests go to `/login?redirect=`) joins an existing session and sets current; accept and auto-join set `users.current_organization_id` to that team). `/login` lists registered OAuth/SAML providers; `GET /oauth/:provider/callback` sets HMAC `workhub_session` via `authenticateOAuth` (no API token) and ensures a personal workspace (`createPersonalForUser`; default redirect `/organizations` uses `resolveHomePath()` so an invited current team wins over the personal workspace). The JSON callback at `/api/v1/auth/oauth/:provider/callback` still issues a bearer token and also ensures the workspace. `GET/POST /register` (`FEATURE_REGISTRATION`, default on) creates a member with `registerWithPassword`, provisions a Jetstream-style personal workspace (`{name}'s workspace`, slug `personal-{userId}`, owner membership without requiring `currentAuthUser()`), and sets `workhub_session`. `MEMBER_ABILITIES` includes `organizations:create`, so members can add extra teams via HTML `POST /organizations` or JSON `POST /organizations` (`OrganizationPolicy.create` already allowed any authenticated user). Jetstream current team is `users.current_organization_id` (`GET/PUT /users/me/current-organization`; HTML `POST /current-organization` plus the layout Team select). Signed-in HTML `/organizations` marks that team with a Current badge (`data-current-team`); guests see no badge. Organization show repeats the badge when it is current, or a `POST /current-organization` “Switch to this team” button when the viewer is a member of another team. Signed-in HTML `GET /projects` and `GET /tasks` default to that team (override with `?organizationId=`; pagination keeps the filter); guests stay unscoped so public reads still list every project and task. JSON `GET /projects` and `GET /tasks` stay unscoped. Signed-in HTML `GET /search` scopes hits to the current team (same `?organizationId=` override; JSON `GET /search` stays tenant-wide). Signed-in HTML `GET /reports` redirects to `/reports/organizations/{current_organization_id}`; `?all=1` keeps the tenant-wide summary (JSON `GET /reports/summary` stays tenant-wide). HTML login, MFA complete, verify-email (no intended URL), HTML register without verification, and OAuth default home send `/organizations` to the current team via `resolveHomePath()` (invited auto-join wins over the personal workspace show URL). Signed-in `GET /` does the same; guests still land on `/organizations`. HTML create redirects to `/organizations/{id}`. Layout `appName` follows `appDisplayName()`. A leftover webhook that targets a blocked host (`http://127.0.0.1/hook`) is recorded as a failed delivery and does not 400 register or org create (`DispatchWebhookJob` + `dispatchModelWebhook`). `registerDefaultJobs()` does not register `webhook.dispatch`; WorkHub’s webhook provider and `queue:work` call `registerWebhookJobs()`. Signed-in HTML `POST /webhooks` defaults `organization_id` to the current team when the Team field is omitted; the form select starts on that team and `organization_id=` stays tenant-wide. Signed-in HTML `GET /webhooks` lists that team plus tenant-wide endpoints (`?organizationId=` override; `?all=1` is every team). JSON `GET /webhooks` stays tenant-wide. The HTML endpoints table shows the team (JSON `POST /webhooks` still takes optional `organization_id`). Dispatch matches the event and webhook `organization_id` (null is tenant-wide; a team webhook only receives events whose payload org matches). `WebhookService` is constructed with the app `Queue` (WorkHub’s webhook provider) and tracks `webhook.dispatch` on `jobRegistry`; integration coverage calls `dispatch` under `runWithTenantDatabase` so RLS can see team hooks without depending on model-event listeners or process-wide `mock.module` stubs. HTML register without verification still creates the personal workspace, then redirects through `resolveHomePath()`. When `FEATURE_EMAIL_VERIFICATION=true`, it still creates the workspace, sends a verify link, keeps the session, and redirects to `/email/verify`. A same-origin `redirect` is stashed on `${APP_KEY_PREFIX}_intended` (`workhub_intended`) so signed `GET /verify-email` can restore it (Fortify intended URL). `wrapWebAuthenticated` / `wrapWebAbility` apply Laravel `verified` in that mode (`emailVerifiedAt === null` → `/email/verify` plus the same intended cookie for GET/HEAD; JSON 403). Logout and `/email/verify` use `wrapWebAuthenticatedAllowUnverified`. POST `/register` uses `wrapWebRegister`; POST `/login`, `/forgot-password`, and `/email/verification-notification` use `wrapWebLogin` so throttle 429s are HTML forms (do not also wrap with `wrapWeb`). Login accepts `remember=1` to issue a 30-day HMAC session (`createSessionCookie(id, { remember: true })`, `SESSION_REMEMBER_TTL_SECONDS`). The signed payload embeds the TTL so a remember cookie stays valid after the default 7-day session lifetime. GET `/login`, `/register`, and `/forgot-password` use `wrapWebGuest` (Laravel `guest`) so a signed-in verified session redirects to the current team via `resolveHomePath()` (`/organizations/{id}` when set; otherwise `/organizations`; unverified → `/email/verify`). `wrapWebGuest` `home` may be a string or `(user) => path`. SPA/API clients use `POST /api/v1/auth/register` (`wrapRegister`) which returns a bearer token unless email verification is required. `POST /api/v1/auth/forgot-password` and `POST /api/v1/auth/reset-password` are the JSON Fortify equivalents (reset body is `{ email, token, password, password_confirmation }`). `POST /api/v1/auth/email/verification-notification` (`{ email }`) is the JSON equivalent of HTML `/email/verification-notification` and always returns a generic success message.

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
