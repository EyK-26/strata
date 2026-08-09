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

See the [strata](https://github.com/EyK-26/strata) monorepo reference app for full module patterns.
