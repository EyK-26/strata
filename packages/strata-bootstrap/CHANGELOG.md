# @getstrata/bootstrap changelog

## 0.2.63

- `HttpKernel.wrapWebGuest()` `home` accepts `string | ((user) => string | Promise<string>)` so signed-in guest redirects can follow the current team. Default remains `/organizations`.

## 0.2.62

- `HttpKernel.wrapWebPasswordConfirm()` is Laravel `password.confirm` for HTML routes. Peer `@getstrata/core` `^0.5.75`.

## 0.2.61

- `HttpKernel.wrapVerified()` / `wrapWebVerified()` / `wrapWebAuthenticatedAllowUnverified()`. When `FEATURE_EMAIL_VERIFICATION=true`, `wrapWebAuthenticated` and `wrapWebAbility` require a verified email. Peer `@getstrata/core` `^0.5.74`.

## 0.2.60

- Peer `@getstrata/core` `^0.5.73` for public OpenAPI email verification resend.

## 0.2.59

- `HttpKernel.wrapWebGuest()` is Laravel `guest` / `RedirectIfAuthenticated`. Signed-in HTML users redirect to `/organizations` (override the home path). Peer `@getstrata/core` `^0.5.72`.

## 0.2.58

- Peer `@getstrata/core` `^0.5.71` for public OpenAPI `/auth/register`.

## 0.2.57

- Peer `@getstrata/core` `^0.5.70` for optional OAuth `redirectUri`.

## 0.2.56

- Peer `@getstrata/core` `^0.5.69` for `MembershipLookup.updateMemberRole`.

## 0.2.55

- HttpKernel and route builders read `isViewsEnabled` / `isSpaEnabled` from `@getstrata/core/runtime/frontendMode` instead of WorkHub `src/config/frontend`.

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

- `createCookieSessionAuthManager` / `CookieSessionGuard` turn `CookieSessionStore` into an `AuthGuard` / `AuthManager` for `CORE_AUTH_TOKEN`. Supply a `mapUser` mapper; WorkHub abilities are not baked in. Omit `sql` to read the client from `bindDatabaseConnection()` on every call.
- `checkDatabase()` / `createHealthRoutes()` ping the bound database client, not WorkHub’s private connection holder. `/health` stays `{ status: "ok" }` unless `{ pingOnHealth: true }`. Extra JSON fields are optional.
- `assertProductionSecrets()` is feature-gated. A production HTMX app with `SESSION_SECRET` (32+), `AUTH_DEV_HEADERS=false`, and feature flags off does not need WorkHub API tokens. WorkHub’s current production env (rotated tokens, CORS, pepper, expiry) still passes.
- Re-exports `CORE_ABILITY_CHECKER_TOKEN` and `CORE_AUTH_USER_DIRECTORY_TOKEN`.
