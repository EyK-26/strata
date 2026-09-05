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
# Postgres (HiroApp)
DATABASE_URL=postgresql://postgres:postgres@localhost:54329/hiroapp_test

# MySQL (your app; not HiroApp)
DB_CONNECTION=mysql
DATABASE_URL=mysql://user:pass@localhost:3306/myapp

# SQLite file (local toys, not HiroApp)
DB_CONNECTION=sqlite
DATABASE_URL=sqlite://tmp/dev.sqlite
```

HiroApp migrations and RLS policies are Postgres. Do not point HiroApp at MySQL or SQLite.

## Query builder

`@getstrata/core/database/query` compiles SQL through `currentSqlDialect()`. Tests can wrap a block:

```typescript
import { runWithSqlDialect } from "@getstrata/core/database/dialect";

runWithSqlDialect("mysql", () => {
  // INSERT uses ? and backticks, no RETURNING
});
```

`useSqlDialect("mysql")` changes the process until `resetSqlDialect()`. Prefer `runWithSqlDialect` so the previous dialect always comes back.

The dialect module is a process singleton. Apps must import `@getstrata/core/database/dialect`, not a copied helper, or overrides will not match the query builder.

## Schema builder

`Schema.run(db, "pgsql" | "mysql" | "sqlite", ...)` already picked a grammar per engine. That is how migrations emit `jsonb` vs `JSON` vs `TEXT`. Use the grammar that matches the database you will run.

## Binding the client

HiroApp uses Bun's `Bun.sql` (Postgres) via `bindBunSql()` / `bindDatabaseConnection()`. Your app can bind another client if it speaks the same `unsafe(sql, params)` shape. A dialect change does not invent a MySQL driver. You still provide the connection.

## Tenancy

Postgres RLS is documented in [TENANCY.md](./TENANCY.md). `TENANCY_DRIVER=none` skips `SET LOCAL` for apps without a `tenant` table (the starter template). HiroApp keeps RLS.

## Honest limits

- Compiling MySQL or SQLite SQL is not the same as running HiroApp on those engines.
- `tsMatch` throws off Postgres on purpose.
- MySQL has no `RETURNING`. Insert helpers that expect a returned row need another SELECT, which this repo does not pretend to hide.
- Identifier quoting rejects anything that is not `[A-Za-z_][A-Za-z0-9_]*`.
