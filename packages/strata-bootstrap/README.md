# @getstrata/bootstrap

Application bootstrap for Strata sibling apps: HttpKernel, service container, and web utilities.

## Install

```bash
bun add @getstrata/bootstrap @getstrata/core
```

## Web utilities (getstrata-style apps)

```typescript
import {
  CookieSessionStore,
  createCsrfProtection,
  createWebServer,
  parseFormBody,
  slugify,
} from "@getstrata/bootstrap";
```

`CookieSessionStore` reads optional `is_admin` from the user row for global admin routing via `wrapWebGlobalAdmin`.

## HttpKernel (API / module apps)

```typescript
import { createHttpKernel, createAppContext, coreProviders } from "@getstrata/bootstrap";
```

`createAppContext()` does not call `assertProductionSecrets`. WorkHub calls that from `App.serve()` / `queue:work`. Sibling HTMX apps can call it in production without WorkHub API tokens when feature flags are off — see [SIBLING-HTMX.md](../../docs/SIBLING-HTMX.md).

Sibling HTMX apps should bind `createCookieSessionAuthManager` from `@getstrata/bootstrap/web/session` instead of HMAC `SessionGuard`. Use `signIn` / `signOut` (or the redirect helpers) instead of calling `CookieSessionStore` from controllers. Pass `mapUser` to map roles in the app. Pass `loadSessionUser` when the default `learn_subscriber` / `is_admin` SELECT does not match your schema. WorkHub’s table is `sessions` (`0031_create_sessions`); its loader is `loadWorkhubSessionUser` (maps `users.role`, decrypts email). WorkHub web login itself stays on HMAC `SessionGuard`.

`wrapWeb` applies the web group (CSRF + flash) and `withErrorHandling`, so CSRF `ForbiddenError` becomes an HTML 403 in `FRONTEND_MODE=server-htmx`. `wrapWebGuest` is Laravel `guest` / `RedirectIfAuthenticated` (signed-in users go to `/organizations` by default; pass a string or `(user) => path` to override). `wrapWebLogin` / `wrapWebRegister` include that web group plus throttle — do not wrap them with `wrapWeb` again. The throttle callback should return an HTML form at 429 (WorkHub’s `/login` and `/register` do).

`registerDefaultJobs()` registers `cache.invalidate-tags` and `audit.export` only. WorkHub webhook dispatch is `registerWebhookJobs()` in the app webhook provider.

These subpaths remain WorkHub-oriented and are not a generic starter API: `@getstrata/bootstrap/createRoutes` (includes SCIM), `@getstrata/bootstrap/schedule`, and `@getstrata/bootstrap/createWebRoutes` (redirects `/` to `/organizations`).

See the [strata](https://github.com/EyK-26/strata) monorepo reference app for full module patterns.
