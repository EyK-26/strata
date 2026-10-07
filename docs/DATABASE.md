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
# Postgres (in-repo HiroApp runtime uses strata_app on hiroapp_test)
DATABASE_URL=postgresql://strata_app:dev-strata-app-change-me@localhost:54329/hiroapp_test
MIGRATION_DATABASE_URL=postgresql://postgres:dev-postgres-change-me@localhost:54329/hiroapp_test

# MySQL as the app's only engine (not mixed with Postgres)
DB_CONNECTION=mysql
DATABASE_URL=mysql://user:pass@localhost:3306/myapp

# SQLite file (local toys)
DB_CONNECTION=sqlite
DATABASE_URL=sqlite://tmp/dev.sqlite
```

Pick **one** primary database per app. Named connections can attach another engine for a sidecar, but that is not how the in-repo examples run.

When `TENANCY_DRIVER=rls`, production `DATABASE_URL` must not be a superuser or `BYPASSRLS` role. Generated Compose and `--no-docker` apps create `strata_app` for that. Production boot rejects username `postgres` or `root`, then inspects live `pg_roles`. See [TENANCY.md](./TENANCY.md).

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

### Filter operators

`where` values accept a scalar, an array (shorthand for `in`), or an operator object:

| Operator | SQL |
|----------|-----|
| `eq` | `= ?`, or `IS NULL` when the value is `null` |
| `ne` | `<> ?`, or `IS NOT NULL` when the value is `null` |
| `in` | `IN (...)`, or `1 = 0` when the list is empty |
| `notIn` | `NOT IN (...)`, or `1 = 1` when the list is empty |
| `gt` `gte` `lt` `lte` | `>` `>=` `<` `<=` |
| `isNull` | `IS NULL` / `IS NOT NULL` |
| `ilike` | case-insensitive match for the dialect |
| `tsMatch` | `@@ plainto_tsquery`, PostgreSQL only |

An unrecognized key throws rather than silently dropping the filter, so a typo cannot widen a result set.

```typescript
await repository.query().where({ status: { ne: "archived" } }).get();
await repository.query().whereNotIn("status", ["draft", "void"]).get();
```

### Aggregates

`count`, `sum`, `avg`, `min`, and `max` are available on the repository and accept an optional filter. They return the raw value; `avg` is not rounded.

```typescript
const revenue = await orders.sum("total", { status: "paid" });
```

### Writes

`upsert` inserts or updates in one statement. Conflict columns need a unique index; passing an empty update list makes it insert-or-ignore. It compiles to `ON CONFLICT` on PostgreSQL and SQLite and to `ON DUPLICATE KEY UPDATE` on MySQL, and returns `null` when nothing was written.

```typescript
await counters.upsert({ slug: "home", hits: 1 }, ["slug"]);
await counters.upsert({ slug: "home" }, ["slug"], []);
```

`incrementById` and `decrementById` update in place with `column = column + n`, so two concurrent callers cannot lose an update the way a read-then-write would.

`runInTransaction()` is the business transaction boundary. Inside an open `runWithTenantDatabase()` transaction it uses a savepoint, so a throw rolls back that unit and leaves the outer transaction open. `withJsonErrorHandling()`, `withErrorHandling()`, and the JSON error middleware call `requestTransactionRollback()` when they catch an exception and return an error response. The open transaction or savepoint then rolls back instead of committing. A handler that returns a 4xx response without throwing does not roll back. If you catch inside the transaction yourself and still return a response, call `requestTransactionRollback()` or the writes commit. Nested same-tenant scopes and migration bypass scopes use SQL savepoints on the active connection and restore `app.tenant_id`, `app.bypass_rls`, and `app.bypass_identifier`. Cross-tenant nesting and concurrent sibling savepoints are rejected. Previously unset custom PostgreSQL settings restore to an empty value, which represents no identity.

`BaseRepository.create` / `updateById` / `deleteById` / `restoreById` dispatch `table.created` (and the matching write events) through `dispatchModelEvent()`. Outside a framework transaction that is immediate. Inside `runInTransaction()`, `runWithTenantDatabase()`, or `runWithMigrationBypass()`, the event waits for a successful commit and is dropped on rollback. Nested `begin` callbacks promote queued events to the outer commit. A savepoint rollback drops only the events queued inside that savepoint. Wrap a raw `pool.begin()` with `runWithDeferredModelEvents()` if you need the same contract. Model observers still run before commit.

`Model.firstOrCreate` reads first, then inserts. If a concurrent writer wins that race the unique violation is caught and the existing row is returned, so a duplicate never surfaces as a conflict. Any other error propagates.

### Walking large tables

`chunkById` pages by keyset instead of `OFFSET`, so rows are neither skipped nor repeated when the callback mutates what it reads. Return `false` to stop early. Prefer it over `chunk` for anything that writes.

```typescript
await orders.chunkById(500, async (rows) => {
  await archive(rows);
});
```

### Relation counts

`withCount` adds a correlated count as a selected column, without loading the relation.

```typescript
const squads = await Squad.query().withCount("members").get();
squads[0].toObject().members_count;
```

### Models

Mass assignment is opt-in. A model must declare `static $fillable = [...]` to allow specific columns, or `static $guarded = []` to allow all of them. A model that declares neither throws on `create`/`update` rather than silently discarding every attribute.

`$casts` supports `date`, `datetime`, `json`, `bool`/`boolean`, `integer`/`int`, and `hashed`. `hashed` hashes the value with bcrypt on write and leaves an already-hashed value untouched, so re-saving a loaded model does not double-hash.

Model `create`, new/existing instance `save`, and `update` await write casts before issuing SQL. The `hashed` cast uses the same asynchronous Bun bcrypt helper as authentication (cost 12); construction, hydration and `mergeAttributes` do not hash. Null/undefined and recognized bcrypt/Argon2 strings keep their existing behavior. Hash-prefix recognition is compatibility behavior, not validation of an imported hash.

**Low-level helper migration:** await `applyCasts(values, casts, "dehydrate")` (always a promise) and `dehydrateValue(value, "hashed")` (now a promise, including null/undefined and existing hashes). `applyCasts(..., "hydrate")` and individual non-hashed `dehydrateValue` casts stay synchronous. If the cast or direction is dynamic, await the result before using it. Existing model write callers already await their writes and need no changes. Protected `dehydrateAttributes` overrides may return a record or a promise; overrides that call `super` must await its result before modifying it.

Observer order is preserved: static `create` resolves casts before its pre-write observers; instance `save` runs pre-write observers before casting, so cancellation skips hashing. Hash rejection prevents that model's SQL. Use `runInTransaction` to roll back earlier business writes and deferred events when hashing or an observer fails; this change does not add an implicit transaction around arbitrary model operations. Direct repository/SQL/bulk writes bypass model casts and must supply prepared values.


### Eager loading (`with` / `load`)

`Product.with("category")` and `cartItem.load("product")` take **relation method names**, not model class names. `category()` is `with("category")`. `with("Category")` throws unless you defined `Category()`. Laravel-style arrays work: `with(["category"])` and `load(["product"])`.

Hydrated relations live on `loaded("category")`. There is no magic `product.category` property.

String related models (`belongsTo("Category")`, `hasMany("Product")`) resolve in this order:

1. `registerModelRepository(Category, …)` already names `constructor.name` and `$morphClass`.
2. `registerModelClass("Category", CategoryModel)` only when the string is neither of those (ESM cycles, or a short alias).

Register models in `src/models/register.ts` (import every model so those calls run) **before** the first query. Generated apps emit that file from `preload.ts`. A missing name throws `Model [Category] is not registered`. `make:module` appends a commented `registerModelClass` hint when the file exists.

Eager belongsTo/hasMany queries reuse the parent repository connection (`withConnection`), so Postgres RLS `SET LOCAL app.tenant_id` on the request transaction also applies to related rows. Model `addGlobalScope` is applied on `Model.query()`, not on those related repository loads — filter `tenant_id` in your own `where` if you use column tenancy without RLS.

```typescript
import { registerModelClass, registerModelRepository } from "@getstrata/core/database/model";

registerModelClass("Category", Category);
registerModelClass("Product", Product);
registerModelRepository(Category, new CategoryRepository());
registerModelRepository(Product, new ProductRepository());

const products = await Product.with("category").get();
products[0]?.loaded<{ get: (key: string) => unknown }>("category")?.get("name");

const lines = await CartItem.with(["product"]).get();
```

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

A dialect change does not invent a driver. You still provide the connection. `Bun.sql` is Postgres-only. MySQL uses `mysql2` (an optional peer of `@getstrata/core`; `bun add mysql2` in the app). SQLite uses `bun:sqlite`. The in-repo examples each use one engine.

## Timestamps are UTC on every engine

`sqlTimestamp(date)` renders a `Date` the way the active engine stores it, and `nowExpression()` renders "now" in the same shape, so `expires_at > now` compares like with like whether the check runs in SQL (cookie sessions) or in JS (API tokens).

| Engine | `sqlTimestamp` | `nowExpression()` | Why |
| --- | --- | --- | --- |
| Postgres | `2026-09-20T18:41:51.597Z` | `NOW()` | `TIMESTAMPTZ` parses ISO-8601 and compares instants. |
| SQLite | `2026-09-20T18:41:51.597Z` | `strftime('%Y-%m-%dT%H:%M:%fZ', 'now')` | Timestamps are `TEXT` and compare as strings, so both sides use the same ISO-8601 shape. `CURRENT_TIMESTAMP` (`YYYY-MM-DD HH:MM:SS`) would sort before any `T` value on the same day. |
| MySQL | `2026-09-20 18:41:51` | `CURRENT_TIMESTAMP` | `DATETIME` rejects `T` and `Z`. `createMysqlConnection()` opens the pool with `timezone: "Z"` and runs `SET time_zone = '+00:00'` on every connection, so the driver parses `DATETIME` as UTC and `NOW()` returns UTC regardless of the server default. |

`createMysqlConnection()` stays synchronous and loads `mysql2` on the first query. Use `await createMysqlPool(url)` if you need the raw `mysql2` pool with the same UTC settings.

## Schema builder

`Schema.run(db, "pgsql" | "mysql" | "sqlite", ...)` already picked a grammar per engine. That is how migrations emit `jsonb` vs `JSON` vs `TEXT`. Use the grammar that matches the database you will run.

Use the published `@getstrata/core/database/schema` API for supported DDL. The file migration runner still owns history and execution order; `Schema.run` only compiles and executes the statements. It does not create a transaction on its own.

```ts
await Schema.run(db, "pgsql", (schema) => {
  schema.create("payment_attempts", (table) => {
    table.text("id").primary();
    table.integer("tenant_id");
    table.integer("order_id");
    table.string("note", 500);
    table.text("provider_key");
    table.unique("provider_key", "payment_provider_identity");
    table.foreignKey(["tenant_id", "order_id"], "orders", ["tenant_id", "id"], {
      name: "payment_order_binding",
    });
    table.check("tenant_id > 0 AND order_id > 0", "payment_positive_identity");
  });
});
```

The referenced columns must already have an appropriate unique constraint/index. Foreign keys accept `onDelete: "cascade" | "set null" | "restrict"`; column arrays must be nonempty and have equal lengths. Table checks and foreign keys can be added through `schema.table` on Postgres/MySQL. SQLite requires a table rebuild for these alterations and throws before execution. SQL check expressions are trusted migration source, never request input. MySQL CHECK enforcement requires MySQL 8.0.16 or newer.

Explicit `string(name, length)` bounds now emit `VARCHAR(length)` on Postgres; omitted lengths retain the existing `TEXT` behavior. SQLite still uses TEXT affinity without enforcing the length. This change affects newly executed DDL only: it does not tighten existing columns. Single-column `table.unique(...)` on create now produces the previously missing constraint; explicit names are preserved for both single and composite constraints. Review existing schemas for these missing constraints and add a new migration after checking existing data; upgrading packages does not repair deployed tables.

Schema grammar identifier quoting now follows the explicitly selected engine, independent of the active query dialect. MySQL index creation omits unsupported `IF NOT EXISTS`, and index deletion includes its owning table. MySQL index operations therefore require accurate migration history; replaying a manually applied index operation can fail on an existing/missing index.

Keep data transformations, unsupported DDL, RLS policy helpers, and guarded rollbacks as explicit SQL where needed. `schema.drop` retains its historical Postgres CASCADE behavior, so use explicit restrictive SQL when a rollback must reject dependent objects. Do not rewrite applied history casually: compare fresh-schema catalogs and populated upgrades before converting existing migration implementations, retain file names, and leave applied databases unchanged.

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
