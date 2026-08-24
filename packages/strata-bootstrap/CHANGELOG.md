# @getstrata/bootstrap changelog

## 0.2.51

- `createCookieSessionAuthManager` returns `CookieSessionAuthManager` (`signIn`, `signOut`, `signInRedirect`, `signOutRedirect`). Controllers no longer need a local cookie helper.
- Pass `loadSessionUser` to replace the default `users.learn_subscriber` / `users.is_admin` session query. Keep `mapUser` in the app.

## 0.2.50

- `createCookieSessionAuthManager` / `CookieSessionGuard` turn `CookieSessionStore` into an `AuthGuard` / `AuthManager` for `CORE_AUTH_TOKEN`. Supply a `mapUser` mapper; WorkHub abilities are not baked in. Omit `sql` to read the client from `bindDatabaseConnection()` on every call.
- `checkDatabase()` / `createHealthRoutes()` ping the bound database client, not WorkHub’s private connection holder. `/health` stays `{ status: "ok" }` unless `{ pingOnHealth: true }`. Extra JSON fields are optional.
- `assertProductionSecrets()` is feature-gated. A production HTMX app with `SESSION_SECRET` (32+), `AUTH_DEV_HEADERS=false`, and feature flags off does not need WorkHub API tokens. WorkHub’s current production env (rotated tokens, CORS, pepper, expiry) still passes.
- Re-exports `CORE_ABILITY_CHECKER_TOKEN` and `CORE_AUTH_USER_DIRECTORY_TOKEN`.
