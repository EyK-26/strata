# Databases

Capture database settings in the application definition and select an owned execution
`DatabaseSession` before querying. Environment variables are entrypoint inputs.

## What we actually run

Framework RLS and coverage fixtures use **PostgreSQL**. Integration tests also execute SQLite and MySQL mechanisms, and the generated-app compiler matrix covers all three engines. The external shop uses Postgres RLS. RLS, `ILIKE` and `tsMatch` are Postgres-specific; consult the engine table below for portable operations. Passing this matrix is not a claim of production capacity for any engine.

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
# Postgres local fixture credentials (legacy database name retained for compatibility)
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

Explicit Postgres provisioning and `grantPostgresAppRolePrivileges` serialize cooperative ACL writers with one database-scoped transaction advisory lock. Full provisioning takes this lock before its existing role-catalog lock; standalone grants do not create/alter roles or require role-catalog rights. They send one atomic privilege batch, so a late SQL failure rolls back earlier grants and releases the lock (or the caller rolls back its enclosing transaction). Use the target application database connection; generated init SQL wraps the same renderer in `BEGIN`/`COMMIT`. Mixed old/uncoordinated grant writers are outside this lock protocol. Production/staging HTTP and workers remain runtime-only and never provision roles or apply grants on boot.

See [PostgreSQL provisioning and migration identities](POSTGRES-PROVISIONING.md) for externally provisioned databases, catalog-administration requirements, schema CREATE provenance and explicit adoption of the runtime grant correction.

## Query builder

`@getstrata/core/database/query` compiles SQL using an explicit `SqlDialect` descriptor, obtained with `dialectFor(driver)`. Repositories select their descriptor from their owned connection.

Migration mutations, `sqlTimestamp()`, and schema builders without a driver use an explicit async context:

```typescript
import { runWithSqlDialect } from "@getstrata/core/database/dialect";
import { migrateDatabase } from "@getstrata/core/database/migrations/runner";

await runWithSqlDialect("mysql", () => migrateDatabase(connection, migrations));
```

`runWithSqlDialect` isolates concurrent callers, retains the selected dialect across `await`, and restores the enclosing context after success or failure. Calls requiring a dialect throw outside this context; there is no process override or environment fallback. `Schema.builder("mysql")` and `Schema.run(connection, "mysql", callback)` also accept an explicit driver without an async context. `resolveDatabaseDriver({ connection, url })` parses supplied options only and throws if neither supplies a supported driver.

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

### Typed grouped sums

`repository.query().where({ order_id }).sumBy("product_id", "quantity")` returns plain typed `{ value, sum }` rows in one SQL query. `value` has the group column's declared type (or null); `sum` is exact database text or null when the group contains only null quantities. Empty input returns an empty array. The fixed aliases cannot be supplied by request input. Declared column validation, dialect identifier quoting, bound predicates, soft-delete policy, protected filters and the active transaction/RLS connection remain in force. Numeric column compatibility is governed by the real database schema, not inferred from names.

The direct form is `repository.sumBy("product_id", "quantity", { where: { order_id } })`. Grouped sums reject joins, custom selection, prior grouping/having, ordering, pagination, row locks and eager loading rather than silently discarding these options. Hold any required business row lock separately inside the same framework transaction. To retain model predicate scopes, use `Model.scopeQuery(repository.query())`; aggregate projections do not hydrate models or execute casts/hooks.

Totals deliberately remain strings across Postgres/MySQL/SQLite: adding integers can exceed the JavaScript safe range or the source column range. Convert only after checking the application's required range; use a decimal/bigint representation when appropriate. Database-native overflow and nonnumeric-column behavior remain visible errors or engine semantics; this API does not promise unlimited precision, integer-only totals or identical floating-point/decimal representations across engines. Existing scalar aggregate APIs are unchanged.

### Writes

`upsert` inserts or updates in one statement. Conflict columns need a unique index; passing an empty update list makes it insert-or-ignore. It compiles to `ON CONFLICT` on PostgreSQL and SQLite and to `ON DUPLICATE KEY UPDATE` on MySQL, and returns `null` when nothing was written.

```typescript
await counters.upsert({ slug: "home", hits: 1 }, ["slug"]);
await counters.upsert({ slug: "home" }, ["slug"], []);
```

`incrementById` and `decrementById` update in place with `column = column + n`, so two concurrent callers cannot lose an update the way a read-then-write would.

`runInTransaction()` is the business transaction boundary. Inside an open `runWithTenantDatabase()` transaction it uses a savepoint, so a throw rolls back that unit and leaves the outer transaction open. `withJsonErrorHandling()`, `withErrorHandling()`, and the JSON error middleware call `requestTransactionRollback()` when they catch an exception and return an error response. The open transaction or savepoint then rolls back instead of committing. A handler that returns a 4xx response without throwing does not roll back. If you catch inside the transaction yourself and still return a response, call `requestTransactionRollback()` or the writes commit. Nested same-tenant scopes and migration bypass scopes use SQL savepoints on the active connection and restore `app.tenant_id`, `app.bypass_rls`, and `app.bypass_identifier`. Cross-tenant nesting and concurrent sibling savepoints are rejected. Previously unset custom PostgreSQL settings restore to an empty value, which represents no identity.

Framework transaction, tenant and bypass helpers bind native transaction callbacks to the complete caller async context before database admission. This preserves auth users/credential sources, request metadata and application-owned async stores when a Bun SQL pool opens a connection or queues acquisition. RLS still installs its own tenant/connection scope inside that callback; callers do not manually reconstruct authentication or bypass CSRF. Direct native `SQL.begin()` callbacks are outside this framework boundary and need their own caller-context binding when they depend on async-local state.

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

`chunkById` pages by keyset instead of `OFFSET`, so rows are neither skipped nor repeated when the callback mutates what it reads. Return `false` to stop early. `chunk` uses that same primary-key walk when the query is already ordered only by its primary key ascending, including the table's default order. Joins, grouping, locks, projections, and any other order stay on `OFFSET`.

`paginate` retains page-number `OFFSET` semantics and its count-plus-row-query budget. An empty filtered total skips the row query. Deep offsets still scan skipped rows; use explicit `cursorPaginate` or composite `keysetPaginate` when the application can expose cursors. A key-only boundary lookup is not enabled automatically: it adds a database round trip and may still fetch heap tuples for visibility or filtering, so it requires workload-specific qualification.

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

### UUID schema columns

`table.uuid("id").primary()` creates a native PostgreSQL `UUID` column. It does not change existing tables, replace UUIDs with text on PostgreSQL, or generate identifiers automatically. Supply an existing UUID or generate one deliberately in application code with `crypto.randomUUID()`. Ordinary `nullable()`, `unique()`, `default()` and explicit dialect-specific `defaultRaw()` modifiers remain available. Auto-increment UUID columns are rejected before executing SQL.

MySQL uses `CHAR(36)` and SQLite uses `TEXT` for this logical column type. These engines do not acquire PostgreSQL's UUID parsing, canonicalization or format validation: use canonical strings and explicit application validation or engine-specific checks when required. The mapping does not emulate binary UUID storage or add database extensions. See the [PostgreSQL UUID type](https://www.postgresql.org/docs/18/datatype-uuid.html), [MySQL UUID conversion functions](https://dev.mysql.com/doc/refman/8.4/en/miscellaneous-functions.html#function_uuid-to-bin), and [SQLite storage classes](https://www.sqlite.org/datatype3.html).

SQLite permits column-level `unique()` when creating a table, but [forbids it in `ADD COLUMN`](https://www.sqlite.org/lang_altertable.html#alter_table_add_column). For an existing table, add a nullable column and declare its unique index separately in the same callback:

```ts
await Schema.run(db, "sqlite", schema => {
  schema.table("invoices", table => {
    table.uuid("external_id").nullable();
    table.unique("external_id", "invoice_external_identity");
  });
});
```

This preserves existing rows, allows multiple null values, and rejects duplicate non-null identities. The same SQLite ALTER restriction applies to other column types. Unsupported column-level ALTER uniqueness throws during compilation, before any statement in that `Schema.run` plan executes. It is not silently omitted or automatically rewritten. PostgreSQL/MySQL alterations and SQLite CREATE behavior are unchanged. When rolling this addition back, drop the named index before dropping the column, using separate `schema.table` calls. Existing apps can already use the explicit index form; upgrading packages does not repair partially applied migrations or change their history. Inspect the physical schema and migration records before retrying an earlier failed migration.

UUID foreign keys use an ordinary UUID column and the table-level constraint API; `foreignId()` retains its existing integer type:

```ts
table.uuid("document_id");
table.foreignKey(["document_id"], "documents", ["id"]);
```

Declare the model key as `string` and allow assignment explicitly when the app supplies it. Models and repositories already support string primary keys; no custom repository is required for UUIDs. Existing explicit UUID DDL through a migration's `db.unsafe()` remains supported. Adopting the builder does not rename migrations, rewrite applied history, or authorize replaying an already-applied definition.

### Typed model inputs and projections

Models with declared record fields infer column names and value types for `create`, `firstOrNew`, `firstOrCreate`, `updateOrCreate`, filters, ordering and primary-key lookups. Concrete subclasses and explicit custom repositories remain supported. Writes accept partial records so generated IDs, nullable fields and database defaults can be omitted. TypeScript interfaces do not describe DDL defaults or required inserts: the database remains responsible for those constraints, and `$fillable`/`$guarded` still control mass assignment. These contracts do not validate untrusted HTTP input at runtime. Declare field types to match casts/driver values, or normalize inputs before calling the model; cast metadata does not automatically infer different write types.

Repository and model definitions retain their record and key types, including non-`id` keys. Select them through `database.repository(definition)` or `database.model(definition)`; upsert conflict/update columns, inputs and results retain those declared types. Static global `Model.repository()` registration is retired.

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

Models are selected from an application-owned execution session. Their bound facade
provides queries, create/find, casts, observers, relationships and instance writes.
There is no per-class global repository cache. Owner selection, model state and
transaction scope are explicit; use after execution expiration rejects.

`attributes.dehydrate` on the model definition accepts a record or promise. Await
asynchronous casts and hashing before SQL. A thrown serialization hook prevents
that write. Dirty-only saves retain intended edits after rollback; a post-commit
listener failure does not undo the committed row. Raw native transaction users must
retain the documented deferred-event boundary.

### Declarative model binding

```typescript
import { BaseRepository } from "@getstrata/core/database/baseRepository";
import { defineModel, defineRepository } from "@getstrata/core/database/definitions";
import { Model } from "@getstrata/core/database/model";
import { defineTable } from "@getstrata/core/database/table";

type ProductRecord = { sku: string; title: string };
const products = defineTable<ProductRecord, "sku">({
  name: "products", primaryKey: "sku", columns: ["sku", "title"],
});
const productRepository = defineRepository({
  name: "products", table: products, dependencies: [],
  create: binding => new BaseRepository(binding),
});
class Product extends Model<ProductRecord, "sku"> {}
const productModel = defineModel({
  name: "Product", repository: productRepository, dependencies: [],
  attributes: { fillable: ["sku", "title"], timestamps: false },
  construct: (state, binding) => new Product(state, binding),
});
```

Include `productRepository` and `productModel` in the `repositories` and `models`
arrays passed to `createDatabaseBindings`. Inside the owned execution, use
`database.model(productModel).find(sku)` or
`database.repository(productRepository).query()`. Definition names and aliases
are validated within that registry. Relationships reference declared model
identities; register all definitions before the application starts.

Custom repository state belongs in `create(binding, ...dependencies)`. Model
construction belongs in `construct(state, binding, source, ...dependencies)`;
serialization belongs in `attributes.dehydrate`. These replace protected cloning
and serialization overrides. `discoverModels`, `bootModels`, `registerModelClass`
and `registerModelRepository` global registration APIs are removed. Generated
modules emit definitions for the application registry; discovery must not acquire
connections or infer an application owner.

## Named connections

Declare named connections in the application's `createDatabaseBindings` configuration
and select them from the current `DatabaseSession`. Registries are owned by that
application; the same connection name in another application selects its own pool.

```typescript
import { createDatabaseBindings } from "@getstrata/core/database/bindings";
import { DATABASE_SESSION_TOKEN } from "@getstrata/core/database/tokens";
import { createApplication } from "@getstrata/core/runtime/application";

const app = createApplication({ providers: [], services: createDatabaseBindings({
  default: "primary",
  connections: {
    primary: { driver: "sqlite", filename: "./primary.sqlite" },
    kiosk: { driver: "sqlite", filename: "./kiosk.sqlite" },
  },
}) });
try {
  await app.start();
  await app.run(async scope => {
    const kiosk = scope.resolve(DATABASE_SESSION_TOKEN).connection("kiosk");
    await kiosk.execute({ text: "SELECT 1", params: [] });
  });
} finally {
  const result = await app.stop();
  if (!result.successful) throw new Error("Application cleanup incomplete");
}
```

Unknown names and use after the selected execution scope expires reject. There is
no process-wide connection registration, default/bound pool lookup, or implicit
repository proxy. `registerNamedConnection` and `runOnNamedConnection` have been
removed along with their public subpath. See [application-owned sessions](DATABASE-SESSIONS.md)
for repository/model binding and explicit transactions. MySQL uses the optional
`mysql2` peer; SQLite uses `bun:sqlite`; a dialect choice does not invent a driver.

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

## Explicit native clients

`createBunSqlPool(options)` remains an explicit PostgreSQL constructor. Callers own
its cleanup. `createDatabaseQueryProxy(pool)` also remains available for explicit
raw-adapter consumers; it receives the pool and uses the existing raw transaction
context, without registering a default connection. `bindBunSql`, global default
and bound connection APIs, and `repositoryConnection` have been removed.
Generated applications use their declared application-owned database bindings.
A live PostgreSQL RLS role check receives both the explicit environment and an
inspector bound to the selected pool/session; there is no default-pool fallback
or mutable inspector override. Applicable checks fail closed if inspection is
missing, fails, or returns malformed/unsafe role data.

## Tenancy

Postgres RLS is documented in [TENANCY.md](./TENANCY.md). `TENANCY_DRIVER=none` skips `SET LOCAL` for applications without tenancy. Generate Postgres RLS applications with `--tenancy=rls`; other engines support column tenancy.

## Honest limits

- Compiler checks and focused live-engine integration cases do not establish production throughput or full application qualification.
- Named connections are sidecars. Do not shard one product row across three engines.
- `tsMatch` throws off Postgres on purpose.
- MySQL has no `RETURNING`. Insert helpers that expect a returned row need another SELECT.
- Identifier quoting rejects anything that is not `[A-Za-z_][A-Za-z0-9_]*`.

### Selected generated persistence

Generated business handlers receive selected persistence capabilities through the
owned execution context. Repositories and models use that selected session's
pool, dialect, tenant policy, and transaction scope. An expired capability cannot
fall back to a process default. Explicit low-level native adapters remain available
for separately owned tooling; they do not supply ambient application authority.

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

Connection capabilities are defined independently of repository behavior. Existing
`DatabaseConnection` imports from the core root, `database` and `database/baseRepository`
remain supported. Native transaction checkout and interruptible read-only observation
remain optional capabilities; consumers must reject unsupported operations rather than
silently simulate them. Internal adapters depend on the type-only connection contract,
so they do not import the repository implementation to describe their transport.

## Composing record factories

Factories use explicit definitions and dependencies through
`@getstrata/core/database/factory`. The same `Factory` and `defineFactory` exports
are available from the package root and database barrel. Factory subclassing and
protected overrides have been replaced by construction functions.

```ts
import { defineFactory, Factory, type FactoryPersist } from "@getstrata/core/database/factory";

type Widget = { id: number; name: string };
type Dependencies = { persist?: FactoryPersist<Widget> };
const WidgetFactory = defineFactory<Widget, Dependencies>({
  construct: dependencies => ({
    definition: () => ({ id: 0, name: "Widget" }),
    persist: dependencies.persist,
  }),
});
const widgets = Factory.from(WidgetFactory, {});
widgets.make();                         // one complete Widget, no database work
widgets.count(1).make();                // Widget[], including count(1)
widgets.state({ name: "Custom" }).make();
```

`create()` requires a supplied persistence callback. It removes a placeholder
`id` of `0`, `null`, or `undefined` before calling that callback and returns its
persisted record. Bind persistence inside the selected database invocation or
transaction scope, for example `persist: async values => (await
selectedModel.create(values)).toObject()`. The factory retains that exact
capability. Await `create()` before leaving the scope; saving a factory does not
extend its session lifetime or select another owner after the scope expires.
See [application-owned SQL sessions](DATABASE-SESSIONS.md).

`bun run cli make:factory widget` emits a `WidgetFactory` definition and
`createWidgetFactory(dependencies)` helper. Its dependencies require
`definition: () => WidgetRecord`, returning every required domain field, and
optionally accept `persist: FactoryPersist<WidgetRecord>`. Supply your own
complete definition for pure `make()` calls. `create()` without persistence
rejects explicitly. The generator does not invent model fields, retain an
application singleton, or discover a database session.

For mutable generation state, use the stateful overload:

```ts
const SerialWidgetFactory = defineFactory<Widget, Dependencies, { serial: number }>({
  initialState: () => ({ serial: 0 }),
  forkState: state => ({ serial: state.serial }),
  construct: (state, dependencies) => ({
    definition: () => ({ id: 0, name: `Widget ${state.serial++}` }),
    persist: dependencies.persist,
  }),
});
```

Every fluent branch constructs genuine behavior and forks the explicit state.
A behavior class can initialize native private fields in its constructor;
methods are called on that genuine receiver. Mutable state that should survive
a branch belongs in the explicit state object. Other behavior-private counters
and caches are reconstructed. `forkState` owns the isolation of nested user
state; `Readonly` is shallow. Dependencies and captured closures may be shared
intentionally. Construction and callbacks can have user effects that the
framework cannot roll back.

A branch copies its current sequence cursor, so using it does not advance the
source factory. Merge order is definition, ordered state transforms, sequence,
parent associations, call overrides, then `afterMaking`. Literal state and
sequence patches are snapshotted shallowly when registered. `for` and `recycle`
snapshot the parent id; Model parents can infer the foreign key from their
repository table. Explicit keys retain the record-key type contract.

`afterMaking` is synchronous and returns `undefined`; ordinary block callbacks
work without an explicit return. Async callbacks and callbacks annotated to
return `void` do not satisfy this contract. Wrap a known synchronous void helper
in a block, or use `afterCreating` for asynchronous work. This type contract does
not make arbitrary casts or untyped async callbacks safe.

`has` snapshots the child's plan, explicit state, and cursor when registered.
Each parent creates a fresh association branch from that snapshot. This changes
the former behavior where subsequently using the external child could affect a
parent's later child sequence. `make()` does not create children. `create()`
prepares all child associations before starting child writes, launches siblings
concurrently, and joins every started outcome before returning or rejecting.
One failed child preserves its exact rejection reason; multiple failures become
an `AggregateError` in registration order, retaining repeated and falsy reasons.
Child failure skips `afterCreating`. Otherwise, `afterCreating` callbacks run
and are awaited in registration order. Counted parent creation is sequential.
Parent and child operations are atomic only when explicitly bound to the
appropriate transaction; factories do not introduce an implicit transaction.
