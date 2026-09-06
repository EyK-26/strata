# @getstrata/bootstrap changelog

## 0.4.3

- Cookie session `mapUser` / row mapping can pass `email_verified_at` through as `emailVerifiedAt` so HTML email verification works.
- Session insert binds `expires_at` as an ISO string so SQLite cookie login does not fail parameter binding.

## 0.4.2

- `HttpKernel.wrapApi` uses `withJsonErrorHandling`. Hybrid views do not turn API errors into HTML.

## 0.4.1

- `createSpaRoutes` reads `SPA_PREFIX`, registers `prefix`, `prefix/`, and `prefix/*`, and accepts `distDirectory` plus `wrap`. Hybrid still does not redirect `/`.
- `appEnvSchema` defaults `SPA_PREFIX` from core `DEFAULT_SPA_PREFIX`.
- Peer `@getstrata/core` `^0.7.1`.

## 0.4.0

- Peer `@getstrata/core` `^0.7.0`.
- Production `SESSION_SECRET` is required whenever views are on (`FRONTEND_MODE=server-htmx` or `hybrid`).
- Hybrid SPA routes stay under `/app/*`. They do not redirect `/`, so staff HTML keeps the home path.
- `appEnvSchema` validates `FRONTEND_MODE` with the core pattern, including `hybrid`.
- `HttpKernel.wrapApi` maps thrown HTTP errors to JSON the same way `wrapWeb` maps them to HTML.

## 0.3.0

- Peer `@getstrata/core` `^0.6.0`.
- Cookie session SQL uses the current SQL dialect for placeholders, `NOW()`, and `NULLS LAST`.
- Kernel comments describe guest, verified-email, and password-confirm gates without referring to another framework.

## 0.2.68

- `configureModulesDirectory()` clears the discovered-module cache when the directory changes, so OpenAPI/`createApp` can load HiroApp after core tests pointed at empty fixtures.
- `createWebRoutes()` / `mergeWebRoutes()` accept optional `{ modules }` so leftover bootstrap route assembly does not pick up the dogfood app's modules. `CreateWebRoutesOptions` is exported from the public API.

## 0.2.67

- `CookieSessionStore.create()` records optional browser metadata (`userAgent`, `ipAddress`, `last_active_at`).
- `CookieSessionStore` can list live sessions, touch `last_active_at`, and destroy every session except the current cookie (`listForUser`, `touch`, `destroyOtherSessions`).
- `CookieSessionAuthManager.signIn()` / `signInRedirect()` accept the same metadata. Apps that use cookie sessions (HiroApp) must have `user_agent`, `ip_address`, and `last_active_at` on `sessions`.

## 0.2.66

- `assertProductionSecrets()` is feature-gated for every app. API tokens no longer imply the previous in-repo app's encryption/CORS/OAuth/public-read checklist. Published test token strings are still denied. the previous in-repo app's extra production profile lives in the app (`src/config/productionSecrets.ts`).
- **Breaking:** `HttpKernel.wrapWebGuest()` defaults `home` to `/` instead of `/organizations`. Apps with an org home should pass that path (the previous in-repo app already does).
- `createWebRoutes()` no longer seeds a `/` → `/organizations` redirect. The in-repo app owns `/` via its organization module.

## 0.2.65

- App listener discovery reads `src/listeners` from `process.cwd()` so a built `@getstrata/bootstrap` bundle still finds the previous in-repo app registrars (`import.meta.dir` after `build:bootstrap` is the package dist). Listener boot calls each registrar every time (registrars are idempotent per `eventBus`).

## 0.2.64

- `registerDefaultJobs()` no longer registers the previous in-repo app `webhook.dispatch`. Apps that dispatch model webhooks should call `registerWebhookJobs()` (the previous in-repo app's webhook provider and `queue:work` do).

## 0.2.63

- `HttpKernel.wrapWebGuest()` `home` accepts `string | ((user) => string | Promise<string>)` so signed-in guest redirects can follow the current team. Default remains `/organizations`.

## 0.2.62

- `HttpKernel.wrapWebPasswordConfirm()` is the previous PHP framework `password.confirm` for HTML routes. Peer `@getstrata/core` `^0.5.75`.

## 0.2.61

- `HttpKernel.wrapVerified()` / `wrapWebVerified()` / `wrapWebAuthenticatedAllowUnverified()`. When `FEATURE_EMAIL_VERIFICATION=true`, `wrapWebAuthenticated` and `wrapWebAbility` require a verified email. Peer `@getstrata/core` `^0.5.74`.

## 0.2.60

- Peer `@getstrata/core` `^0.5.73` for public OpenAPI email verification resend.

## 0.2.59

- `HttpKernel.wrapWebGuest()` is the previous PHP framework `guest` / `RedirectIfAuthenticated`. Signed-in HTML users redirect to `/organizations` (override the home path). Peer `@getstrata/core` `^0.5.72`.

## 0.2.58

- Peer `@getstrata/core` `^0.5.71` for public OpenAPI `/auth/register`.

## 0.2.57

- Peer `@getstrata/core` `^0.5.70` for optional OAuth `redirectUri`.

## 0.2.56

- Peer `@getstrata/core` `^0.5.69` for `MembershipLookup.updateMemberRole`.

## 0.2.55

- HttpKernel and route builders read `isViewsEnabled` / `isSpaEnabled` from `@getstrata/core/runtime/frontendMode` instead of the previous in-repo app `src/config/frontend`.

## 0.2.54

- `HttpKernel.wrapSigned()` applies `createValidateSignatureMiddleware` so HTMX routes can require a valid signed URL.

## 0.2.53

- `registerDefaultJobs()` also registers `audit.export` (`ExportAuditLogsJob`).
- In-process `audit-export` schedule runs that job instead of calling `exportPendingAuditLogs()` inline.

## 0.2.52

- View provider registers `configureWebErrorView` so `errors/*.eta` render through the app Eta layout. `EtaViewEngine` receives `Request` from the layout-data resolver.
- `createWebServer` unknown routes and null handlers return styled HTML 404s and run inside request ALS so `configureWebLayoutData` can read the session cookie.
- `wrapSecuredRouteModelByKey` is documented as the wrong default for public HTML show pages; a missing model is a styled 404 and HTML/composite GET ETags stay off.

## 0.2.51

- `createCookieSessionAuthManager` returns `CookieSessionAuthManager` (`signIn`, `signOut`, `signInRedirect`, `signOutRedirect`). Controllers no longer need a local cookie helper.
- Pass `loadSessionUser` to replace the default `users.learn_subscriber` / `users.is_admin` session query. Keep `mapUser` in the app.

## 0.2.50

- `createCookieSessionAuthManager` / `CookieSessionGuard` turn `CookieSessionStore` into an `AuthGuard` / `AuthManager` for `CORE_AUTH_TOKEN`. Supply a `mapUser` mapper; the previous in-repo app abilities are not baked in. Omit `sql` to read the client from `bindDatabaseConnection()` on every call.
- `checkDatabase()` / `createHealthRoutes()` ping the bound database client, not the previous in-repo app's private connection holder. `/health` stays `{ status: "ok" }` unless `{ pingOnHealth: true }`. Extra JSON fields are optional.
- `assertProductionSecrets()` is feature-gated. A production HTMX app with `SESSION_SECRET` (32+), `AUTH_DEV_HEADERS=false`, and feature flags off does not need the previous in-repo app API tokens. the previous in-repo app's current production env (rotated tokens, CORS, pepper, expiry) still passes.
- Re-exports `CORE_ABILITY_CHECKER_TOKEN` and `CORE_AUTH_USER_DIRECTORY_TOKEN`.
