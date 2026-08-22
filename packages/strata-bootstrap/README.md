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

`createAppContext()` does not call `assertProductionSecrets`. WorkHub calls that from `App.serve()` / `queue:work`. Sibling apps should call it only if they want those WorkHub production gates (API tokens, Stripe, SCIM, CORS).

`wrapWeb` applies the web group (CSRF + flash) and `withErrorHandling`, so CSRF `ForbiddenError` becomes an HTML 403 in `FRONTEND_MODE=server-htmx`. `wrapWebLogin` / `wrapWebRegister` include that web group plus throttle — do not wrap them with `wrapWeb` again.

These subpaths remain WorkHub-oriented and are not a generic starter API: `@getstrata/bootstrap/createRoutes` (includes SCIM), `@getstrata/bootstrap/schedule`, and `@getstrata/bootstrap/createWebRoutes` (redirects `/` to `/organizations`).

See the [strata](https://github.com/EyK-26/strata) monorepo reference app for full module patterns.
