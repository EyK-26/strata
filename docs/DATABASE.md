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

### Explicit null ordering

Ordinary repository/model ordering accepts `nulls: "first" | "last"` on a column order item. Omit it to preserve the database's default; shorthand ordering remains unchanged. Use a final unique tie-breaker for bounded deterministic batches:

```typescript
await receipts.query().where({ processing_state: { ne: "processed" } }).orderBy([
  { column: "last_attempt_at", direction: "ASC", nulls: "first" },
  { column: "received_at", direction: "ASC" },
  { column: "id", direction: "ASC" },
]).project(["id"]);
```

Postgres/SQLite compile native `NULLS FIRST/LAST`; MySQL uses a null discriminator before the value within that order item. Invalid placement values reject before query execution. Values, column identifiers and direction retain their existing validation/binding contracts. Model selection and plain projections share this ordering. This does not add nullable keyset cursors: keyset source/cursor values must still be non-null bounded scalars. Explicit placement can affect index usage; measure representative plans rather than assuming every ordering has an index seek.

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

### Cancellable transaction acquisition

```ts
import { runInTransaction } from "@getstrata/core/database/transaction";

await runInTransaction(async db => {
  await db.unsafe("SELECT 1");
}, { acquisitionSignal: AbortSignal.timeout(1000) });
```

The optional `acquisitionSignal` controls admission and native pool checkout, **not** SQL execution or cancellation of an admitted business callback. A pre-aborted signal fails before any transaction/reservation. At the outer boundary the adapter must implement native `reserve({signal})`, `begin()` on its reservation and `release()`; unsupported adapters fail explicitly rather than pretending a Promise race cancels checkout. The tested Bun 1.4.2 SQL pool implements this [native acquisition contract](https://bun.sh/docs/runtime/sql). Existing calls without an option continue using `begin()` directly, including SQLite/MySQL adapters.

The reservation is released on success, rollback, malformed-adapter rejection or cancellation between checkout and callback admission. Once the callback starts, later aborts do not silently roll back or suppress commit; use database query deadlines or explicit business rollback separately. Nested calls use the existing connection/savepoint and never reserve another slot. Cancellation before a nested callback rolls back that savepoint; cancellation of a running callback does not automatically abort its parent. Admission cancellation does not cancel an in-flight BEGIN/SAVEPOINT command; the signal is rechecked before the business callback. Connection/network timeouts still apply to those commands.

Release occurs before committed deferred observers flush, so reentrant observers can acquire the same single-slot pool. Existing observer, SQL failure, deferred-event and tenant-scope semantics remain unchanged. This option does not install signal handlers, change tenancy or bind a global connection.

`BaseRepository.create` / `updateById` / `deleteById` / `restoreById` dispatch `table.created` (and the matching write events) through `dispatchModelEvent()`. Outside a framework transaction that is immediate. Inside `runInTransaction()`, `runWithTenantDatabase()`, or `runWithMigrationBypass()`, the event waits for a successful commit and is dropped on rollback. Nested `begin` callbacks promote queued events to the outer commit. A savepoint rollback drops only the events queued inside that savepoint. Wrap a raw `pool.begin()` with `runWithDeferredModelEvents()` if you need the same contract. Model observers still run before commit.

`Model.firstOrCreate` reads first, then inserts. If a concurrent writer wins that race the unique violation is caught and the existing row is returned, so a duplicate never surfaces as a conflict. Any other error propagates.

### Observing native transaction checkout

`createTransactionAcquisitionMetrics()` creates an optional bounded process-local collector. Pass it as `runInTransaction(operation, { acquisitionMetrics })` and to `createMetricsRoutes({ transactionAcquisition: acquisitionMetrics })`. Opting in requires native reservation support and measures only the outer checkout, including pool wait and connection establishment. Nested savepoints do not produce another acquisition observation; business errors do not become checkout errors. Without metrics or an acquisition signal the existing direct `begin()` path is unchanged. See [runtime metrics](RUNTIME-METRICS.md#opt-in-transaction-acquisition-observations) for outcomes, cancellation semantics, aggregation and coverage limits. This is not a global pool statistic or a claim to instrument every direct SQL/tenant request.

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

### Typed model inputs and projections

Models with declared record fields infer column names and value types for `create`, `firstOrNew`, `firstOrCreate`, `updateOrCreate`, filters, ordering and primary-key lookups. Concrete subclasses and explicit custom repositories remain supported. Writes accept partial records so generated IDs, nullable fields and database defaults can be omitted. TypeScript interfaces do not describe DDL defaults or required inserts: the database remains responsible for those constraints, and `$fillable`/`$guarded` still control mass assignment. These contracts do not validate untrusted HTTP input at runtime. Declare field types to match casts/driver values, or normalize inputs before calling the model; cast metadata does not automatically infer different write types.

```ts
await Product.create({ title: "Notebook", price: 12 });
const rows = await Product.where({ price: { gte: 10 } })
  .orderBy({ title: "asc" })
  .select("title", "price")
  .get(); // Array<Pick<ProductRecord, "title" | "price">>
const first = await Product.query().select("title").first(); // selected row or null
```

Call `select` after building the model query. Its `get`/`first` methods return plain selected records with hydration casts, without model methods, appended fields, eager relations or retrieved observers. They are SQL projections, not model serialization: `$hidden` does not remove explicitly selected columns. Only declared table columns are supported; empty or unknown column lists fail at execution. `first` does not change the query's limit for later `get` calls. Model global scopes, transaction connections and database RLS still apply. `BaseRepository.query().project(["title", "price"])` provides the corresponding typed driver-row projection without model casts.

`newFromRecord(fullRecord)` is the checked hydration entry point. For unsaved partial values, use `newFromRecord(partialRecord, false)`. Trusted driver rows or deliberate partial hydration can use `newFromTrustedRecord(record, exists)`; its caller owns completeness and scalar correctness. Partial hydration does not establish that all model fields exist. Existing dirty-write behavior is preserved.

#### Source compatibility

Previously accepted misspelled columns and wrong scalar types now fail compilation for models with declared fields. Dynamic/index-signature models retain loose contracts. Normal TypeScript structural typing applies; `any` and untyped data can bypass static checks. Qualified joins and dynamically constructed predicates can use `query().whereDynamic(...)` or the underlying repository query. Direct SQL, bulk operations, locking and custom repositories remain available. These escape hatches retain existing runtime semantics and do not disable database RLS.

Move partial `all({ select: ... })` and `firstWhere(..., { select: ... })` reads to `query().select(...)`; those model-returning helpers no longer accept partial selects. Migrate deliberate partial `newFromRecord(...)` calls to the trusted entry point (or pass `false` for an unsaved instance). Raw repository `QueryOptions.select` remains a trusted escape hatch and cannot prove full row completeness. No schema migration or automatic row conversion accompanies this source-contract change.

### Models

Mass assignment is opt-in. A model must declare `static $fillable = [...]` to allow specific columns, or `static $guarded = []` to allow all of them. A model that declares neither throws on `create`/`update` rather than silently discarding every attribute.

`$casts` supports `date`, `datetime`, `json`, `bool`/`boolean`, `integer`/`int`, and `hashed`. `hashed` hashes the value with bcrypt on write and leaves an already-hashed value untouched, so re-saving a loaded model does not double-hash.

Model `create`, new/existing instance `save`, and `update` await write casts before issuing SQL. The `hashed` cast uses the same asynchronous Bun bcrypt helper as authentication (cost 12); construction, hydration and `mergeAttributes` do not hash. Null/undefined and recognized bcrypt/Argon2 strings keep their existing behavior. Hash-prefix recognition is compatibility behavior, not validation of an imported hash.

**Low-level helper migration:** await `applyCasts(values, casts, "dehydrate")` (always a promise) and `dehydrateValue(value, "hashed")` (now a promise, including null/undefined and existing hashes). `applyCasts(..., "hydrate")` and individual non-hashed `dehydrateValue` casts stay synchronous. If the cast or direction is dynamic, await the result before using it. Existing model write callers already await their writes and need no changes. Protected `dehydrateAttributes` overrides may return a record or a promise; overrides that call `super` must await its result before modifying it.

Observer order is preserved: static `create` resolves casts before its pre-write observers; instance `save` runs pre-write observers before casting, so cancellation skips hashing. Hash rejection prevents that model's SQL. Use `runInTransaction` to roll back earlier business writes and deferred events when hashing or an observer fails; this change does not add an implicit transaction around arbitrary model operations. Direct repository/SQL/bulk writes bypass model casts and must supply prepared values.

Loaded instances keep a snapshot of their hydrated attributes. Existing-instance `save()` writes only changed fields, including changes from `saving`/`updating` observers and in-place JSON, date and binary mutations. This prevents a stale instance's unchanged fields from overwriting another writer's updates. Unchanged passwords do not enter the write-cast pipeline. Inserts still write their full assignable payload; repository, bulk and direct SQL operations retain their explicit write behavior.

A no-op `save()` runs `saving`, `updating` and `saved`, but skips SQL, timestamps, `updated` observers and repository update events. A real update sets `updated_at` when timestamps are enabled. Successful writes replace the snapshot with the returned database row; edits from post-write observers remain dirty for the next save. Re-query the model to reload external changes without writing.

Framework transactions and savepoints restore snapshot bookkeeping on rollback, retaining intended edits so the same instance can retry. Changes pulled in by the rolled-back write's returned row are discarded. Newly inserted instances saved through `save()` return to their previous existence state on rollback. Raw `pool.begin()` callers must wrap the transaction with `runWithDeferredModelEvents()` for this bookkeeping, just as for deferred events. A listener failure after commit does not reset the snapshot. No-op saves do not check whether an unchanged row still exists.

Changed-field writes are not optimistic locking: competing changes to the same field still require explicit locking, a conditional update or a version check. No version column or schema migration is required.


### Eager loading (`with` / `load`)

`Product.with("category")` and `cartItem.load("product")` take **relation method names**, not model class names. `category()` is `with("category")`. `with("Category")` throws unless you defined `Category()`. Laravel-style arrays work: `with(["category"])` and `load(["product"])`.

Hydrated relations live on `loaded("category")`. There is no magic `product.category` property.

String related models (`belongsTo("Category")`, `hasMany("Product")`) use the class name or `$morphClass` registered at startup. Generated apps await framework model discovery before handling requests. `registerModelClass("catalog-category", Category)` remains available for a distinct alias; keep alternate aliases in startup code before any boot hook that uses them.

### Declarative model binding

```typescript
import { defineModel } from "@getstrata/core/database/model";
import { defineTable } from "@getstrata/core/database/table";

interface ProductRecord { sku: string; title: string }
const products = defineTable<ProductRecord, "sku">({
  name: "products", primaryKey: "sku", columns: ["sku", "title"],
});
class Product extends defineModel(products) {
  static $fillable = ["sku", "title"] as const;
  static $timestamps = false;
}
export { Product };
```

`defineModel(table)` supplies a typed model base. The framework creates and caches one default repository per concrete class on first use or startup initialization. Subclasses inherit table metadata, with separate repository and boot state. Concrete model results, casts, observers, scopes, SQL projections, bulk operations and locking continue to use existing APIs. This definition does not generate migrations or infer a schema from erased TypeScript interfaces.

In generated `src/models/register.ts`:

```typescript
import { discoverModels } from "@getstrata/bootstrap/discoverModels";
await discoverModels(import.meta.dir);
```

Discovery recursively imports `.ts`, `.js`, `.mts` and `.mjs` files from the trusted application directory, collects named/default exported Model subclasses, registers all class names and morph aliases, then initializes repositories and boot hooks. It deduplicates re-exports, rejects ambiguous names, and propagates import, definition and boot errors to startup. Symlinks, declaration files, and reserved `register.ts`/`register.js`/`index.ts`/`index.js` orchestration/barrel files are skipped. Use `exclude` for additional orchestration files. No request or tenant controls the discovery directory. Await discovery before HTTP, worker or scheduled work begins.

For bundled deployments or models outside `src/models`, use a static manifest instead: `bootModels([Product, Category])` from `@getstrata/core/database/model`. Import all model modules first. Class-reference or lazy-reference relationships do not require name discovery; string references do. Framework discovery cannot see a class whose module has never been imported. Alternate aliases must be registered before boot if hooks depend on them.

Existing `class Product extends Model<ProductRecord, "sku">` plus `registerModelRepository(Product, repository)` remains supported. To customize a declarative model, call `registerModelRepository(Product, customRepository)` before startup initialization. Explicit bindings take precedence over defaults. Custom repository methods stay available on the repository itself; registration does not add methods to the model. Keep startup bindings stable rather than rebinding per request. The default connection still resolves the framework's active request/transaction scope; discovery never selects tenants, opens a database connection, or bypasses RLS.

Normal model reads, `Model.chunk()` and `Model.cursorPaginate()` retain global scopes. Each scope is grouped separately and ANDed with caller predicates, including top-level or callback OR conditions. Repeated `where()` predicates compose with AND; they no longer replace an earlier filter on the same column. Callback `where()` predicates form a group. Cursor bounds also intersect existing filters rather than overwriting a key condition or allowing an OR branch to escape the cursor. To intentionally read without model global scopes, use the explicit repository API. This does not disable database RLS or the repository's soft-delete policy.

Model-defined relations apply the **related target model's** global filters to lazy reads, batched eager loads, existence/absence predicates and projected counts. This covers hasMany/hasOne, belongsTo, belongsToMany, hasManyThrough and polymorphic relations. Relation `where()` filters also compose with AND and are retained during eager loading; association keys and morph discriminators cannot be overwritten by those filters. Target soft-delete filters apply to existence and count subqueries as well as normal reads.

Eager loads reuse the parent repository connection (`withConnection`), preserving Postgres RLS `SET LOCAL` on the request transaction. Collection loading stays batched, with one target query per known morph type. Morph targets match both type and ID, so a missing or filtered target cannot borrow another type's row with the same ID. Eager hasOne selects the first visible row per parent, rather than limiting the entire batch to one row.

`hasManyThrough` applies target model scopes to the far table; intermediate/pivot tables are joins, not hydrated related models, and their model boot scopes are not automatically applied. Use RLS on every tenant-owned table or explicit scoped join constraints. Explicit low-level repository relation loaders remain unscoped with respect to model global filters. Legacy raw morph indexing helpers key their map by ID; callers mixing types with overlapping IDs must partition by type, as the model eager loader does.

`Model.scopeQuery(repository.query())` applies model filters to a query on an explicitly selected repository/connection. `RepositoryQuery.getOptions()` exposes the compiled filters for the framework's batched loaders; `QueryOptions.whereNodes` carries grouped predicates through those loaders. Scopes that constrain rows with predicates and joins participate in existence queries. A scope join that collides with the outer parent or a fixed pivot/through table is rejected in correlated queries rather than silently binding to the wrong table; use an explicitly aliased correlated predicate for those policies. Projection, ordering, pagination and grouped aggregates are query transformations, not row-visibility guarantees, and are not a substitute for policies or database RLS.

```typescript
import { registerModelClass, registerModelRepository } from "@getstrata/core/database/model";

// Only alternate aliases need registerModelClass.
registerModelClass("catalog-category", Category);
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

### Generated Postgres query handle

Postgres starters expose `SqlClient = SqlDatabaseConnection`, retaining both bound `unsafe(text, params)` and tagged-template calls. `getSql()` returns the framework transaction-aware query proxy, so tagged calls use the active request/savepoint connection rather than the pool. For example, a tagged `SELECT` with `${productId}` binds the value instead of interpolating SQL text. Tagged results remain plain driver rows; the public interface returns `unknown[]`, while typed model projections are preferred for declared application records. SQLite/MySQL starter adapters retain their existing unsafe-only application handle; this change does not promise native Bun helpers on those adapters.

### Typed pessimistic row locks

Inside `runInTransaction` (or a Postgres tenant scope), call `query().lockForUpdate()` or `query().sharedLock()` before `first()`, `get()` or `select(...)`. Selection stays on the active connection and returns the same typed models/plain projections. Query options also accept `lock: { mode: "update" | "share", wait?, of? }` for repositories. `wait` is `"wait"` (default), `"nowait"` or `"skipLocked"`. PostgreSQL supports `of: ["table_name"]` for locking selected query tables; MySQL 8+ supports the lock/wait modes but rejects `of`. SQLite rejects row locking instead of silently omitting it; use its explicit write transaction semantics. Raw database/native transactions outside the framework do not satisfy the active-connection guard.

Locks last until transaction completion. Grouped queries and `count()` cannot take row locks. Eager-loading child queries do not inherit the parent's lock; explicitly design any child locking and its order. Keep business lock ordering deterministic. `SKIP LOCKED` is suitable for competing work claims, not a consistent full listing or pagination promise. Driver isolation, deadlocks and lock timeouts still apply; applications own replay-safe business effects. Advanced SQL remains a supported escape hatch.

### Conditional set-based repository writes

Use a repository query when a write must include an expected state or ownership predicate in the same statement:

```ts
const affected = await inventoryRepository.query()
  .where({ id: productId, stock: expectedStock })
  .update({ stock: expectedStock - quantity });
if (affected !== 1) throw new Error("Inventory changed; retry checkout.");
```

`updateWhere(changes, options)` and `deleteWhere(options)` are the direct repository equivalents. Fluent `update(changes)` and `delete()` return the driver's affected-row count. PostgreSQL and SQLite derive this count from the statement's RETURNING rows; the official MySQL adapter supplies affectedRows metadata (including unchanged matches under its default FOUND_ROWS setting). Custom MySQL adapters must preserve that metadata. A zero count means the predicate did not match; it is not inferred from a later SELECT. The framework-bound connection preserves the active transaction and tenant scope. Database constraints and RLS still apply.

On PostgreSQL and SQLite, `query.updateReturning(changes, "id", "stock")` (or `repository.updateWhereReturning(changes, columns, options)`) returns plain typed projections directly from the UPDATE. MySQL rejects RETURNING before executing; it does not emulate it with an unlocked second query. Bulk deletes respect the configured soft-delete column and visibility scope. These operations require an explicit predicate, reject primary-key/unknown-column updates and empty changes, and reject joins, eager loading, grouping, selection, ordering, limits and locks rather than silently discarding selection semantics. A predicate can intentionally match every row; the guard is against an omitted predicate, not a substitute for authorization.

These are low-level set-based operations: values must already be ready for the database. They do not hydrate models, apply model fillable/write-cast/timestamp policy, or emit per-row observer events. In particular, never pass plaintext passwords to this API. Use instance model writes for those behaviors, or explicitly write a business outbox event inside the transaction after checking the affected count. Protected query predicates remain grouped outside caller OR predicates. Existing direct SQL remains supported for expressions, advanced joined writes and other database-specific operations.

The official SQLite adapter normalizes bound `Date` values to UTC ISO strings before passing them to Bun. Invalid dates fail before statement execution; they cannot shift positional bindings or silently turn a conditional mutation into a no-op.

### Explicit generated 64-bit identities

Use `table.bigId()` (or `table.bigId("order_id")`) for an automatically generated 64-bit primary key. PostgreSQL compiles BIGSERIAL; MySQL compiles BIGINT UNSIGNED AUTO_INCREMENT; SQLite uses its 64-bit INTEGER PRIMARY KEY AUTOINCREMENT rowid. `bigInteger()` remains a non-generated integer column. Existing `id()` migrations retain their current types, including PostgreSQL SERIAL; this addition does not rewrite deployed tables or change generated starter defaults.

Choose compatible foreign-key widths deliberately (`bigInteger()` for PostgreSQL references, with matching signedness for MySQL). Database storage width does not make JavaScript numbers exact beyond `Number.MAX_SAFE_INTEGER`: driver numeric conversion still applies. Use a configured driver bigint/string representation or explicit text projections for identities above that boundary, and encode them safely in JSON. The integration tests verify generation beyond the signed 32-bit boundary; they do not claim automatic precision-safe conversion across the entire 64-bit range. Existing SQL remains available for database-specific identity options and altering deployed identity columns.

### Composite keyset pages

`keysetPaginate()` is additive; `cursorPaginate()` keeps its primary-key cursor contract. Use composite pages when a stable business ordering contains ties, such as timestamp-ordered history:

```typescript
import type { KeysetCursor } from "@getstrata/core/pagination";

const cursor: KeysetCursor | undefined = validatedCursor;
const page = await Order.query()
  .where({ user_id: authenticatedUser.id })
  .select("id", "created_at", "status")
  .keysetPaginate({
    perPage: 20,
    orderBy: [
      { column: "created_at", direction: "desc" },
      { column: "id", direction: "desc" },
    ],
    cursor,
  });
// page.data is the selected plain record array.
// JSON-encode page.meta.next_cursor for the next forward page, if non-null.
```

Repository queries and model queries support `keysetPaginate()`. Full model pages use the existing hydration, casts and batched eager-loading path. Selected model pages stay partial. Repository `projectKeyset(columns, options)` returns typed plain selected records. Static `Model.keysetPaginate(options)` retains model scopes. Cursor predicates intersect caller predicates, model scopes and soft-delete policy; database RLS remains authoritative.

Provide 1–8 distinct declared scalar ordering columns with explicit `asc`/`desc` directions, ending in the table's declared primary key. Mixed directions are supported. Page sizes must be integers from 1 through 1000; applications should choose a smaller bound appropriate to their endpoints. Ordering fields must be non-null in the TypeScript record **and actual database schema**, and the declared primary key must really be unique. Nullable/JSON fields are excluded from typed ordering. Joined/grouped queries, explicit limits and offsets are rejected. The keyset ordering replaces earlier query ordering. Internal `__strata_keyset_` projection aliases are reserved.

On PostgreSQL, multi-column keysets with all directions equal use a native row comparison as the continuation bound, allowing a matching compound index to seek at the cursor. Mixed directions retain lexicographic branches. SQLite/MySQL compilation is unchanged. Index usefulness still depends on query predicates, database statistics and the actual schema; include applicable tenant/business equality predicates when designing the index, while preserving RLS as the access control. This optimization is not a guarantee for arbitrary query plans or a capacity qualification.

Cursor values are bounded database text projections, obtained before native date hydration, so sub-millisecond timestamps and adjacent floating-point boundaries survive continuation. Pass the returned versioned cursor unchanged; do not rebuild it from hydrated `Date` values or JavaScript numbers. A cursor with different columns/directions or malformed values is rejected. Comparisons use bound parameters and the database column's types and collation. Keep types, collation, database session timezone and ordering consistent across requests. Unsupported or null source keys fail explicitly; this is not schema introspection.

The application owns HTTP encoding, input validation, authorization and any cursor signing. Cursors expose their ordering values and are not authorization tokens; reapply the same authorized filters on every request and avoid sensitive sort columns. `next_cursor` is null when no further row was observed. `prev_cursor` records the incoming boundary; it does not provide reverse traversal. Pages are forward continuations, not snapshots: deleting a boundary row is safe, newly inserted rows after the boundary may appear, and rows inserted before it are excluded. Use immutable sort keys to avoid skips or repeats caused by updates. Add suitable indexes and measure query plans for the actual filters and workload.

### Independent SQLite observations

File-backed `createSqliteConnection` adapters expose the optional `DatabaseConnection.observeReadOnly(callback, { signal, timeoutMs })` capability. It opens a separate read-only snapshot in a disposable Bun CLI process, runs serialized queries through IPC, and waits for process exit on completion, failure or cancellation. A 1–5,000ms deadline includes interpreter startup. Synchronous SQLite VM/file work runs off the request event loop; cancellation kills the process instead of leaving an uninterruptible query or queued callback behind. The business adapter and its transaction queue are unchanged. The adapter refuses closure until admitted observations drain.

This opt-in infrastructure path requires the tested Bun CLI on trusted PATH (also for compiled applications); it inherits no application environment, env files or application config preloads. File paths travel through IPC, and child SQL errors carry no query/driver/payload text. Concurrent queries within one observation are rejected. SQLite query-only/read-only mode prevents writes, and BEGIN retains a consistent snapshot. Busy locks fail immediately rather than waiting on the business connection. A separate connection cannot observe the same private `:memory:` database, so that configuration fails explicitly. Process startup consumes CPU/resources; qualify scrape frequency on the deployment. This does not add worker-process overhead to ordinary application queries or transactions.

### Independent MySQL observations

`createMysqlConnection(url)` exposes the same `observeReadOnly` capability using a dedicated mysql2 connection in an isolated Bun CLI process. The URL and resolved peer module travel through IPC, not command arguments or inherited environment. It uses UTC and an InnoDB read-only transaction; ordinary application queries continue using the existing pool. Adapter close stops admission and drains observations before closing the pool. `createMysqlConnectionFromPool` fails explicitly for observation because it has no public URL configuration to create an independently interruptible connection. See [runtime metrics requirements](RUNTIME-METRICS.md#mysql-collector-requirements-and-costs) for additional connection budgets, tested engine, schema guards and the distinction between client deadlines and server cleanup.
