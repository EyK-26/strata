# @getstrata/core

Runtime library for [Strata](https://github.com/EyK-26/strata) apps: HTTP, auth, database, queue, mail, and security. Requires Bun (tested on 1.4.x).

Generate an app rather than wiring this by hand:

```bash
bunx create-strata my-app
```

## Import subpaths, not the root

Apps, and anything they import, should use subpaths:

```typescript
import { createAuthMiddleware } from "@getstrata/core/http/authMiddleware";
import { bindDatabaseConnection } from "@getstrata/core/database/bindConnection";
import { BaseRepository } from "@getstrata/core/database/baseRepository";
import { FormRequest } from "@getstrata/core/http/formRequest";
import { Policy } from "@getstrata/core/auth/policy";
import { withErrorHandling } from "@getstrata/core/http/response";
import { ValidationError } from "@getstrata/core/errors/http";
import type { Migration } from "@getstrata/core/database/migrations/types";
```

The root `@getstrata/core` import resolves, but nothing stops you from ending up with two copies of process-wide state: the database pool, the dialect override, async-local auth and tenant context, and the `HttpError` base class used with `instanceof`. Some subpaths re-export the main bundle for exactly that reason. Prefer subpaths everywhere and the problem does not arise.

## Database

Set `DATABASE_URL` before the first query; the connection is created lazily.

```typescript
process.env.DATABASE_URL ??= "postgresql://postgres:postgres@localhost:5432/myapp";
```

The engine is your choice, and an app should have one primary engine. Postgres apps use Bun's built-in `Bun.sql` through `createBunSqlPool()`, then `registerDefaultDatabasePool()` and `bindDatabaseConnection()`; `bindBunSql()` registers both. SQLite and MySQL register through `database/sqliteConnection` and `database/mysqlConnection`, or `registerNamedConnection` from `database/namedConnections`.

`orderBy` takes `{ column, direction }` objects or column shorthand such as `{ published_at: "desc" }`. `{ ilike }` uses the value as-is, so pass `%term%` yourself.

Full-text `tsMatch` is PostgreSQL only.

`mysql2` and `eta` are direct dependencies, so they install even for a SQLite JSON API app.

## Views

`.eta` files are HTML plus Eta tags (`<% %>`, `<%= %>`, `<%~ include() %>`). Pug-style class or id shorthand such as `section.section` throws at render time and names the offending template.

## Admin and queue helpers

- `AdminResourceRegistry`, `formatAdminValue`: read-only resource browsers
- `createFailedJobService`, `FailedJobService.delete()`: failed job persistence and cleanup
- `runQueueJob`, `jobRegistry`: dispatch retried jobs from admin UIs

Generated apps do not include an admin dashboard, and the registry is optional.

## Docs

- [Getting started](https://github.com/EyK-26/strata/blob/main/docs/GETTING-STARTED.md)
- [Building apps](https://github.com/EyK-26/strata/blob/main/docs/BUILDING-APPS.md)
- [Auth choices](https://github.com/EyK-26/strata/blob/main/docs/AUTH.md)
- [Databases](https://github.com/EyK-26/strata/blob/main/docs/DATABASE.md)
- [Production](https://github.com/EyK-26/strata/blob/main/docs/PRODUCTION.md)

Contributing to the framework itself: [CONTRIBUTING.md](https://github.com/EyK-26/strata/blob/main/CONTRIBUTING.md).
