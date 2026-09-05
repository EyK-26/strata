# @getstrata/bootstrap

Application bootstrap for Strata apps: HttpKernel, service container, and web utilities.

## Install

```bash
bun add @getstrata/bootstrap @getstrata/core
```

## Web utilities

```typescript
import {
  CookieSessionStore,
  createCsrfProtection,
  createWebServer,
  parseFormBody,
  slugify,
} from "@getstrata/bootstrap";
```

`CookieSessionStore` can read `is_admin` from the user row for `wrapWebGlobalAdmin`. Pass `loadSessionUser` when your `users` table does not match the default `SELECT u.*`.

## HttpKernel

```typescript
import { createHttpKernel, createAppContext, coreProviders } from "@getstrata/bootstrap";
```

`createAppContext()` does not call `assertProductionSecrets`. That helper is feature-gated (tokens, CORS, OAuth, encryption only when those features are on). HTML apps can call it without API tokens when those flags are off. See [docs/BUILDING-APPS.md](../../docs/BUILDING-APPS.md) and [docs/PRODUCTION.md](../../docs/PRODUCTION.md).

HTML apps should bind `createCookieSessionAuthManager` from `@getstrata/bootstrap/web/session` instead of HMAC `SessionGuard`. Use `signIn` / `signOut` (or the redirect helpers). Pass `mapUser` to map roles in the app.

`wrapWeb` applies the web group (CSRF + flash) and `withErrorHandling`, so CSRF `ForbiddenError` becomes an HTML 403 in `FRONTEND_MODE=server-htmx`. `wrapWebGuest` sends signed-in users to `/` by default (pass a string or `(user) => path` to override). `wrapWebLogin` / `wrapWebRegister` include that web group plus throttle. Do not wrap them with `wrapWeb` again. The throttle callback should return an HTML form at 429.

`registerDefaultJobs()` registers `cache.invalidate-tags` and `audit.export` only. Apps that dispatch model webhooks should call `registerWebhookJobs()` themselves.

These subpaths assemble leftover fixture HTTP for framework tests and are not a generic starter API: `@getstrata/bootstrap/createRoutes`, `@getstrata/bootstrap/schedule`, `@getstrata/bootstrap/createWebRoutes`. New apps should use `buildWebModuleRoutes` / `buildModuleRoutes`. HiroApp uses `createApp()` in `apps/hiroapp`.
