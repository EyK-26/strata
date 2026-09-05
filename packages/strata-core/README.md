# @getstrata/core

Stable **Strata** framework surface for application modules.

**Source:** `src/framework/public-api.ts` (monorepo)
**Repository:** [EyK-26/strata](https://github.com/EyK-26/strata), directory `packages/strata-core`

HiroApp is the example product. Import this package from your own modules. HTML cookie apps: [docs/BUILDING-APPS.md](../../docs/BUILDING-APPS.md). Auth choices: [docs/AUTH.md](../../docs/AUTH.md). SQL engines: [docs/DATABASE.md](../../docs/DATABASE.md).

## Usage

Set `DATABASE_URL` before importing (the connection is created lazily on first query):

```typescript
process.env.DATABASE_URL ??= "postgresql://postgres:postgres@localhost:5432/myapp";

import { Policy } from "@getstrata/core/auth/policy";
import { BaseRepository } from "@getstrata/core/database/baseRepository";
import { FormRequest } from "@getstrata/core/http/formRequest";
import { withErrorHandling } from "@getstrata/core/http/response";
import { EtaViewEngine } from "@getstrata/core/view";
```

`.eta` files are **HTML + Eta tags** (`<% %>`, `<%= %>`, `<%~ include() %>`), not another template language. Class/attribute shorthand such as `section.section` or `a href=` fails at render time with the template name.

**Dependency:** `eta` is a direct dependency of `@getstrata/core`. Apps do not need to list it separately. The database **engine** is your choice. Generated HiroApp uses **Bun's built-in `Bun.sql`** (Postgres): `createBunSqlPool()`, then `registerDefaultDatabasePool()` and `bindDatabaseConnection()`. `bindBunSql()` is a helper that registers both. Extra engines register with `registerNamedConnection` (`database/namedConnections`, `database/sqliteConnection`, `database/mysqlConnection`).

`orderBy` accepts `{ column, direction }` objects or column shorthand such as `{ published_at: "desc" }`. `{ ilike }` uses the value as-is. Pass `%term%` yourself.

## Admin and queue helpers

- `AdminResourceRegistry`, `formatAdminValue`: read-only resource browsers
- `createFailedJobService`, `FailedJobService.delete()`: failed job persistence and cleanup
- `runQueueJob`, `jobRegistry`: dispatch retried jobs from admin UIs

Core ships failed-job helpers and an optional admin resource registry. Generated HiroApp does not include an admin dashboard. You do not have to use the registry.

## Build and verify (monorepo root)

```bash
bun run build:framework
bun run verify:framework
bun run verify:shared-subpaths
```

## Subpath imports

`@getstrata/core` publishes many subpaths (for example `@getstrata/core/http/authMiddleware`, `@getstrata/core/database/migrations`). Prefer subpaths over the root import in apps, bootstrap, and tests.

Some subpaths **re-export the main bundle** so singleton state stays shared (database pool, dialect override, async-local auth/tenant, `HttpError` for `instanceof`). The list lives in `scripts/core-shared-subpaths.ts`.

When adding a subpath that owns process-wide state or base classes used with `instanceof`, append it to `CORE_SHARED_SUBPATHS`, run `bun scripts/sync-package-subpaths.ts`, and rebuild.

`scripts/verify-no-root-imports.ts` blocks root `@getstrata/core` imports in application source.

```typescript
import { createAuthMiddleware } from "@getstrata/core/http/authMiddleware";
import { bindDatabaseConnection } from "@getstrata/core/database/bindConnection";
import { ValidationError } from "@getstrata/core/errors/http";
import type { Migration } from "@getstrata/core/database/migrations/types";
```

## Publish to npm

Package name: **`@getstrata/core`** (npm org [`@getstrata`](https://www.npmjs.com/org/getstrata)).

1. Add `NPM_TOKEN` to GitHub repository secrets.
2. Tag a release: `git tag v0.7.4 && git push origin v0.7.4`
3. [Release workflow](../../.github/workflows/release.yml) builds and runs `npm publish --access public`.

See [docs/PACKAGING.md](../../docs/PACKAGING.md).
