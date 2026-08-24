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
import { bindDatabaseConnection } from "@getstrata/core/database/bindConnection";

bindDatabaseConnection(sql);

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

Omit `sql` so the store reads the client from `bindDatabaseConnection()` / the default pool on every call. Tests can reset the pool without a local auth facade.

Cookie names:

| Cookie | Default | Override |
|--------|---------|----------|
| HMAC session (`SessionGuard`) | `workhub_session` | `SESSION_COOKIE_NAME` |
| CSRF | `workhub_csrf` | `CSRF_COOKIE_NAME` |
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

`resolveWebLayoutData` does not assume WorkHub’s directory. Configure sibling templates with:

```typescript
import { configureWebLayoutData } from "@getstrata/core/view";

configureWebLayoutData({
  userKey: "currentUser",
  loadUser: async () => {
    const user = await sessionStore.read(request);
    return user ? { ...user, role: user.is_admin ? "admin" : "member" } : null;
  },
});
```

Apps that do not have orgs should not call `configureMembershipLookup`.

`createRoutes` / `createWebRoutes` / `schedule` stay WorkHub-oriented. Sibling HTMX apps should use `buildWebModuleRoutes` (optionally `seedRoutes: createHealthRoutes(deps, { pingOnHealth: true })`).

## Bound-pool health

`checkDatabase()` / `createHealthRoutes()` ping the client already registered with `bindDatabaseConnection()` (then `registerDefaultDatabasePool`). They do not open WorkHub’s private `connectionHolder`.

`GET /health` stays `{ status: "ok" }` unless you pass `{ pingOnHealth: true }`. `GET /ready` always checks the database (and Redis when `REDIS_URL` is set). Extra JSON fields are merged via `{ extra }`.

## Feature-gated `assertProductionSecrets`

WorkHub still calls this from `App.serve()` / `queue:work`. `createAppContext()` does not. A production HTMX app with `DATABASE_URL`, `SESSION_SECRET` (32+ chars), `AUTH_DEV_HEADERS=false`, and feature flags off can call it without WorkHub API tokens.

See [PRODUCTION.md](./PRODUCTION.md) for the matrix.

## Facades types

`import { cache, mail, events, queue, auth } from "@getstrata/core/facades"` typechecks. CI verifies every `exports.*.types` path exists after `bun run build` in the published packages.
