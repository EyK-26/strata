# @getstrata/core

Runtime library for [Strata](https://github.com/EyK-26/strata) apps: HTTP, auth, database, queue, mail, and security. Requires Bun >=1.4.4 (tested on 1.4.4).

Generate an app rather than wiring this by hand:

```bash
bunx create-strata my-app
```

## Import subpaths, not the root

Apps, and anything they import, should use subpaths:

```typescript
import { createAuthMiddleware } from "@getstrata/core/http/authMiddleware";
import { createModel } from "@getstrata/core/database/model";
import { defineTable } from "@getstrata/core/database/table";
import { BaseRepository } from "@getstrata/core/database/baseRepository";
import { FormRequest } from "@getstrata/core/http/formRequest";
import { Policy } from "@getstrata/core/auth/policy";
import { withErrorHandling } from "@getstrata/core/http/response";
import { ValidationError } from "@getstrata/core/errors/http";
import type { Migration } from "@getstrata/core/database/migrations/types";
```

Prefer focused subpaths for application imports and keep test seams on
`@getstrata/core/testing`.

## Database

The application owns its connection and execution sessions. Configure its selected
engine at startup, then use `database.model(definition)` or
`database.repository(definition)` from the current execution. Transactions select
models and repositories from their supplied transaction session. Global default
pools, named-connection registries and `bindBunSql` are retired.

Use `createModel` and `defineTable` for ordinary models. Custom repository,
connection and adapter APIs remain available for advanced integrations; see the
[database guide](https://github.com/EyK-26/strata/blob/main/docs/DATABASE.md).

`orderBy` takes `{ column, direction }` objects or column shorthand such as `{ published_at: "desc" }`. `{ ilike }` uses the value as-is, so pass `%term%` yourself.

Full-text `tsMatch` is PostgreSQL only.

`eta` and `mysql2` are optional peers. Core loads them with `import()` the first time you render a view or open a MySQL connection. SQLite and Postgres apps do not install `mysql2`. Generated apps add `eta` because the welcome page uses it. MySQL apps also add `mysql2`. The MySQL helpers are exported from `@getstrata/core/database/mysqlConnection`, `@getstrata/core/database`, and the root barrel; importing any of them does not install `mysql2`, and apps should prefer the subpath as with every other core module. The subpath re-exports the barrel, so both share one lazy `mysql2` load.

## Views

`.eta` files are HTML plus Eta tags (`<% %>`, `<%= %>`, `<%~ include() %>`). Pug-style class or id shorthand such as `section.section` throws at render time and names the offending template.

## Admin and queue helpers

- `AdminResourceRegistry`, `formatAdminValue`: read-only resource browsers
- `createFailedJobService`, `FailedJobService.delete()`: failed job persistence and cleanup
- `runQueueJob` with an application-owned job registry: dispatch retried jobs from admin UIs

Generated apps do not include an admin dashboard, and the registry is optional.

## Docs

- [Getting started](https://github.com/EyK-26/strata/blob/main/docs/GETTING-STARTED.md)
- [Building apps](https://github.com/EyK-26/strata/blob/main/docs/BUILDING-APPS.md)
- [Auth choices](https://github.com/EyK-26/strata/blob/main/docs/AUTH.md)
- [Databases](https://github.com/EyK-26/strata/blob/main/docs/DATABASE.md)
- [Production](https://github.com/EyK-26/strata/blob/main/docs/PRODUCTION.md)

Contributing to the framework itself: [CONTRIBUTING.md](https://github.com/EyK-26/strata/blob/main/CONTRIBUTING.md).
