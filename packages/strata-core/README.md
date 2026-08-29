# @getstrata/core

Stable **Strata** framework surface for application modules.

**Source:** `src/framework/public-api.ts` (monorepo)  
**Repository:** [EyK-26/strata](https://github.com/EyK-26/strata), directory `packages/strata-core`

WorkHub is the reference application built on Strata; import the framework from this package in your own modules. Sibling HTMX apps (Eta, cookie sessions, no API tokens) should follow [docs/SIBLING-HTMX.md](../../docs/SIBLING-HTMX.md).

## Usage

Set `DATABASE_URL` before importing (connection is created lazily on first query):

```typescript
process.env.DATABASE_URL ??= "postgresql://postgres:postgres@localhost:5432/myapp";

import { AdminResourceRegistry } from "@getstrata/core/admin/registry";
import { formatAdminValue } from "@getstrata/core/admin/formatValue";
import { Policy } from "@getstrata/core/auth/policy";
import { BaseRepository } from "@getstrata/core/database/baseRepository";
import { mail } from "@getstrata/core/facades";
import { FormRequest } from "@getstrata/core/http/formRequest";
import { withErrorHandling } from "@getstrata/core/http/response";
import { mailer } from "@getstrata/core/mail/mailer";
import { storage } from "@getstrata/core/facades";
import { EtaViewEngine } from "@getstrata/core/view";
```

`.eta` files are **HTML + Eta tags** (`<% %>`, `<%= %>`, `<%~ include() %>`), not Pug. Class/attribute shorthand such as `section.section` or `a href=` fails at render time with the template name.

**Dependency:** `eta` is bundled as a direct dependency of `@getstrata/core`. Apps do not need to list it separately. The database driver is your app's choice. WorkHub and getstrata use **Bun's built-in `Bun.sql`** client; create and bind it with `createBunSqlPool()` / `bindBunSql()`, or call `bindDatabaseConnection()` yourself.

`orderBy` accepts explicit `{ column, direction }` objects or column shorthand such as `{ published_at: "desc" }`.

## Admin and queue helpers

Exports for admin dashboards and queue recovery:

- `AdminResourceRegistry`, `formatAdminValue`: read-only resource browsers
- `createFailedJobService`, `FailedJobService.delete()`: failed job persistence and cleanup
- `runQueueJob`, `jobRegistry`: dispatch retried jobs from admin UIs

## Build and verify (monorepo root)

```bash
bun run build:framework
bun run verify:framework   # build + public API tests
bun run verify:shared-subpaths  # after build: confirm singleton shims
```

## Subpath imports

`@getstrata/core` publishes **144+ subpaths** (for example `@getstrata/core/http/authMiddleware`,
`@getstrata/core/database/migrations`). Prefer subpaths over the root import in apps, bootstrap, and tests.

Some subpaths **re-export the main bundle** so singleton state stays shared (database pool binding,
`AsyncLocalStorage` auth/tenant context, global registries, `HttpError` / `Notification` classes for
`instanceof`). The canonical list lives in `scripts/core-shared-subpaths.ts` and is verified by
`scripts/verify-core-shared-subpaths.ts` after each framework build.

When adding a subpath that owns process-wide state or base classes used with `instanceof`, append it to
`CORE_SHARED_SUBPATHS`, run `bun scripts/sync-package-subpaths.ts`, and rebuild. Non-shared subpath
bundles are built with generated `--external @getstrata/core/*` flags (all 144+ subpaths) so framework
source can import shared modules via package self-imports (`scripts/codemod-core-self-imports.ts`).
Bootstrap subpath builds externalize all `@getstrata/bootstrap/*` and `@getstrata/core/*` entries.
`scripts/verify-no-root-imports.ts` blocks root `@getstrata/core` imports in application source.
`scripts/verify-no-shared-barrel-imports.ts` blocks `@getstrata/core/database` and
`@getstrata/core/http` barrel imports in application source.
`scripts/audit-public-api-surface.ts` reports root exports with no in-repo root import usage.
`scripts/verify-bundled-subpaths.ts` ensures entries like `http/webFormRequest` do not inline
`ValidationError`.

```typescript
import { createAuthMiddleware } from "@getstrata/core/http/authMiddleware";
import { bindDatabaseConnection } from "@getstrata/core/database/bindConnection";
import { ValidationError } from "@getstrata/core/errors/http";
import type { Migration } from "@getstrata/core/database/migrations/types";
```

## Publish to npm

Package name: **`@getstrata/core`** (npm org [`@getstrata`](https://www.npmjs.com/org/getstrata)).

1. Add `NPM_TOKEN` to GitHub repository secrets.
2. Tag a release: `git tag v0.5.79 && git push origin v0.5.79`
3. [Release workflow](../../.github/workflows/release.yml) builds and runs `npm publish --access public`.

Previously published as `@eyk-workhub/framework@0.1.0`, deprecated in favor of this package.

See [docs/PACKAGING.md](../../docs/PACKAGING.md) for boundaries and future extraction.
