# @getstrata/bootstrap

Application bootstrap for [Strata](https://github.com/EyK-26/strata) apps: HttpKernel, service container, and web session helpers. Requires Bun (tested on 1.4.x).

Generate an app rather than wiring this by hand:

```bash
bunx create-strata my-app
```

## Install

```bash
bun add @getstrata/bootstrap @getstrata/core
```

## HttpKernel and providers

```typescript
import { coreProviders, createAppContext, createHttpKernel } from "@getstrata/bootstrap";
```

`createAppContext()` does not call `assertProductionSecrets`. Call that yourself when `APP_ENV=production`; it is feature-gated, so an HTML app with API tokens off is not asked for token secrets. It rejects empty secrets, short `SESSION_SECRET` values, wildcard `CORS_ALLOWED_ORIGINS`, `AUTH_DEV_HEADERS=true`, `FEATURE_PUBLIC_READS=true`, and any secret still holding a generated `change-me` placeholder.

Build routes with `buildWebModuleRoutes` and `buildModuleRoutes`.

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

`CookieSessionStore` reads `is_admin` from the user row for `wrapWebGlobalAdmin`. Pass `loadSessionUser` when your `users` table does not match the default `SELECT u.*`.

HTML apps should bind `createCookieSessionAuthManager` from `@getstrata/bootstrap/web/session` rather than the HMAC `SessionGuard`, then use `signIn` / `signOut` or the redirect helpers. Pass `mapUser` to map roles.

`wrapWeb` applies the web group (CSRF plus flash) and `withErrorHandling`, so a CSRF `ForbiddenError` becomes an HTML 403 when views are on (`FRONTEND_MODE=server-htmx` or `hybrid`). `wrapWebGuest` sends signed-in users to `/` by default; pass a string or `(user) => path` to override. `wrapWebLogin` and `wrapWebRegister` already include the web group plus throttle, so do not wrap them with `wrapWeb` again. The throttle callback should return an HTML form at 429.

## SPA routes

`createSpaRoutes` and `mergeSpaRoutes` serve `SPA_PREFIX` (default `/app`) as `prefix`, `prefix/`, and `prefix/*`. Hybrid keeps HTML at `/`. Pass `distDirectory` and `wrap` when the app is not the process cwd. Until the SPA is built, the prefix answers 503 telling you to run `bun run frontend:build`; generated apps ship that script.

## Queue

`registerDefaultJobs()` registers `cache.invalidate-tags` and `audit.export` only. Apps that dispatch model webhooks call `registerWebhookJobs()` themselves.

## Not a starter API

`@getstrata/bootstrap/createWebRoutes` and `@getstrata/bootstrap/schedule` assemble in-repo fixture HTTP for framework tests. They are not a general app API. New apps use `buildWebModuleRoutes` and `buildModuleRoutes`.

## Docs

- [Building apps](https://github.com/EyK-26/strata/blob/main/docs/BUILDING-APPS.md)
- [Production](https://github.com/EyK-26/strata/blob/main/docs/PRODUCTION.md)
- [Auth choices](https://github.com/EyK-26/strata/blob/main/docs/AUTH.md)
