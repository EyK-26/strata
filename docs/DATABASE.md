# Databases

Set `DATABASE_URL` (and optionally `DB_CONNECTION`) before the app queries.

## What we actually run

HiroApp, CI, and the coverage gates use **PostgreSQL**. Row-level security, `jsonb`, `ILIKE`, `RETURNING`, and `tsMatch` are Postgres features. That is the supported production path in this repo.

## Choosing an engine

| `DB_CONNECTION` | URL prefix | Placeholders | Identifiers | Case-insensitive match | `RETURNING` | Full-text `tsMatch` |
|-----------------|------------|--------------|-------------|------------------------|-------------|---------------------|
| `pgsql` (default) | `postgres://` or `postgresql://` | `$1` | `"users"` | `ILIKE` | Yes | Yes |
| `mysql` | `mysql://` | `?` | `` `users` `` | `LIKE` | No | Throws |
| `sqlite` | `sqlite:` | `?` | `"users"` | `LIKE` | Yes | Throws |

Aliases: `postgres` / `postgresql` → `pgsql`. `mariadb` → `mysql`.

If `DB_CONNECTION` is unset, the URL scheme picks the dialect. If both are unset, the dialect is `pgsql`.

## How to opt in

```bash
# Postgres (in-repo HTML example uses hiroapp_test)
DATABASE_URL=postgresql://postgres:postgres@localhost:54329/hiroapp_test

# MySQL as the app's only engine (not mixed with Postgres)
DB_CONNECTION=mysql
DATABASE_URL=mysql://user:pass@localhost:3306/myapp

# SQLite file (local toys)
DB_CONNECTION=sqlite
DATABASE_URL=sqlite://tmp/dev.sqlite
```

Pick **one** primary database per app. Named connections can attach another engine for a sidecar, but that is not how the in-repo examples run.

## Query builder

`@getstrata/core/database/query` compiles SQL through `currentSqlDialect()`. Tests can wrap a block:

```typescript
import { runWithSqlDialect } from "@getstrata/core/database/dialect";

runWithSqlDialect("mysql", () => {
  // INSERT uses ? and backticks, no RETURNING
});
```

`useSqlDialect("mysql")` changes the process until `resetSqlDialect()`. Prefer `runWithSqlDialect` so the previous dialect always comes back, including across `await`.

The dialect is stored in AsyncLocalStorage (`@getstrata/sqlDialect`) with a process fallback for `useSqlDialect`. Apps must import `@getstrata/core/database/dialect`, not a copied helper, or overrides will not match the query builder.

## Named connections

Register extra engines without pointing HiroApp OLTP at them:

```typescript
import { createSqliteConnection } from "@getstrata/core/database/sqliteConnection";
import { createMysqlConnection } from "@getstrata/core/database/mysqlConnection";
import { registerNamedConnection, runOnNamedConnection } from "@getstrata/core/database/namedConnections";

registerNamedConnection("kiosk", "sqlite", createSqliteConnection(":memory:"));
registerNamedConnection("analytics", "mysql", createMysqlConnection(process.env.MYSQL_URL!));

await runOnNamedConnection("kiosk", async () => {
  // currentSqlDialect() is sqlite, and unsafe() hits the kiosk handle
});
```

A dialect change does not invent a driver. You still provide the connection. `Bun.sql` is Postgres-only. MySQL uses `mysql2`. SQLite uses `bun:sqlite`. The in-repo examples each use one engine.

## Timestamps are UTC on every engine

`sqlTimestamp(date)` renders a `Date` the way the active engine stores it, and `nowExpression()` renders "now" in the same shape, so `expires_at > now` compares like with like whether the check runs in SQL (cookie sessions) or in JS (API tokens).

| Engine | `sqlTimestamp` | `nowExpression()` | Why |
| --- | --- | --- | --- |
| Postgres | `2026-09-20T18:41:51.597Z` | `NOW()` | `TIMESTAMPTZ` parses ISO-8601 and compares instants. |
| SQLite | `2026-09-20T18:41:51.597Z` | `strftime('%Y-%m-%dT%H:%M:%fZ', 'now')` | Timestamps are `TEXT` and compare as strings, so both sides use the same ISO-8601 shape. `CURRENT_TIMESTAMP` (`YYYY-MM-DD HH:MM:SS`) would sort before any `T` value on the same day. |
| MySQL | `2026-09-20 18:41:51` | `CURRENT_TIMESTAMP` | `DATETIME` rejects `T` and `Z`. `createMysqlConnection()` opens the pool with `timezone: "Z"` and runs `SET time_zone = '+00:00'` on every connection, so the driver parses `DATETIME` as UTC and `NOW()` returns UTC regardless of the server default. |

Use `createMysqlPool(url)` if you need the raw `mysql2` pool with the same UTC settings.

## Schema builder

`Schema.run(db, "pgsql" | "mysql" | "sqlite", ...)` already picked a grammar per engine. That is how migrations emit `jsonb` vs `JSON` vs `TEXT`. Use the grammar that matches the database you will run.

## Binding the client

Generated HiroApp uses Bun's `Bun.sql` (Postgres). `getSql()` calls `createBunSqlPool()`, `registerDefaultDatabasePool()`, then `bindDatabaseConnection()`. `bindBunSql()` is a shorter helper that does the last two steps. A dialect change does not invent a MySQL driver. You still provide the connection.

## Tenancy

Postgres RLS is documented in [TENANCY.md](./TENANCY.md). `TENANCY_DRIVER=none` skips `SET LOCAL` for apps without a `tenant` table (the starter template). HiroApp keeps RLS.

## Honest limits

- Compiling MySQL or SQLite SQL is not the same as running HiroApp OLTP on those engines.
- Named connections are sidecars. Do not shard one product row across three engines.
- `tsMatch` throws off Postgres on purpose.
- MySQL has no `RETURNING`. Insert helpers that expect a returned row need another SELECT.
- Identifier quoting rejects anything that is not `[A-Za-z_][A-Za-z0-9_]*`.
