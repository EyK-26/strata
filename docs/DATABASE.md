# Databases

Use model classes for ordinary application data and select them from the current
execution's database session. Migrations create the schema. Custom repositories,
compiled SQL and native adapters remain available for specialized data access.

## Choose an engine

| Engine     | Application driver | Official adapter       | Important differences                                |
| ---------- | ------------------ | ---------------------- | ---------------------------------------------------- |
| PostgreSQL | `pgsql`            | Native Bun `SQL`       | RLS, `ILIKE`, full-text `tsMatch`, `RETURNING`       |
| MySQL      | `mysql`            | Optional `mysql2` peer | No `RETURNING`; `LIKE` follows column collation      |
| SQLite     | `sqlite`           | Native `bun:sqlite`    | File or private memory database; no row locks or RLS |

The starter's `--database` flag accepts `postgres`, `mysql` or `sqlite`. Its
application definition captures connection configuration from the environment;
framework bindings receive explicit configuration rather than reading `.env`.
Choose one primary database for a feature. Named connections can support separate
stores, but a transaction cannot atomically commit across them.

PostgreSQL and MySQL connections use `{ driver, url }`; SQLite uses
`{ driver: "sqlite", filename: "./storage/app.sqlite" }`. PostgreSQL/MySQL accept a
positive `max` pool size. PostgreSQL also accepts `idleTimeout`, `maxLifetime` and
`connectionTimeout` in seconds. See [session configuration](DATABASE-SESSIONS.md).

## Declare a model

```ts
import { defineModel, field, type ModelAttributes } from '@getstrata/core/database/model';

export class Category extends defineModel({
	table: 'categories',
	fields: { id: field.number(), name: field.string() },
}) {
	static $fillable = ['name'] as const;
	static $timestamps = false;
}

export class Note extends defineModel({
	table: 'notes',
	fields: {
		id: field.number(),
		body: field.string(),
		category_id: field.number(),
		created_at: field.timestamp(),
	},
	defaultOrderBy: { column: 'id', direction: 'ASC' },
}) {
	static $fillable = ['body', 'category_id'] as const;
	static $timestamps = false;

	preview() {
		return this.get('body').slice(0, 80);
	}
	category() {
		return this.belongsTo(Category, 'category_id');
	}
}

export type NoteRecord = ModelAttributes<Note>;
```

Add both classes to the generated `src/models/register.ts` model list, keeping
existing entries. In lower-level application composition, pass `models: [Note,
Category]` to `createDatabaseBindings`. Registration derives default repositories
and snapshots metadata before the application serves work. No separate table,
record interface, repository export or construction callback is required.

The primary key defaults to `id`; set `primaryKey` for another declared field.
`field.string()`, `number()`, `binary()` and `json<T>()` describe attributes;
`field.nullable(field.string())` permits nulls. Boolean fields retain the native
`boolean | number` representation, and timestamps/dates retain `Date | string`.
JSON fields apply JSON casts. Add explicit casts or domain conversion when needed.
These declarations neither create columns nor validate HTTP input.

`$fillable` and `$guarded` govern mass assignment. Declare only intended writable
fields; derive ownership/tenant values from trusted context. Enable `$timestamps`
only when its timestamp columns exist and framework-managed timestamps are wanted.
The example relies on a database default for `created_at`. Generated IDs, nullable
columns and defaults may be omitted from writes, but database constraints still
apply. Use a request validator before writing untrusted data.

## Select models from the current session

Inside a controller, command invocation or other owned execution:

```ts
const notes = database.model(Note);
const note = await notes.create({ body: 'First note', category_id: categoryId });
const found = await notes.findOrFail(note.id);
await found.update({ body: 'Edited note' });
const label = found.preview();
await found.delete();
```

`find(id)` returns a model or `null`; `findOrFail(id)` rejects if missing. Hydrated
models retain subclass methods and their selected database/transaction binding.
Use `get("body")` for attributes, `fill(values)` plus `save()` for deferred edits,
and `update(values)` for an immediate write.

A model class is a declaration, not a global database handle. Use
`database.model(Note).query()`, not an unbound `Note.query()`. Do not retain a
session, bound facade, query, model or persistence-backed factory after its
execution ends. Expired capabilities reject instead of selecting another pool.
Application-lifetime services receive the current session as an argument.
See [application ownership](APPLICATION-OWNERSHIP.md).

`toObject()` returns attributes for internal use. `toArray()`/`toJSON()` apply
serialization visibility such as `$hidden` and `$visible`, appended accessors and
loaded relationships. Avoid returning `toObject()` for records containing secrets.
Casts and asynchronous dehydration run on instance writes; observers and declared
repository effects follow their owning transaction's outcome.

## Query and project

```ts
const notes = database.model(Note);
const page = await notes
	.query()
	.where({ category_id: categoryId })
	.orderBy({ id: 'desc' })
	.paginate({ page: 1, perPage: 20 });

const summaries = await notes
	.query()
	.where({ body: { ne: '' } })
	.select('id', 'body')
	.get(); // Array<Pick<NoteRecord, "id" | "body">>
```

Without `select`, queries return models. Projections return plain selected records
with hydration casts, without model methods or retrieved observers. `$hidden`
does not remove explicitly selected columns: projection is SQL selection, not
serialization. Column names and ordinary scalar inputs are checked by TypeScript;
runtime validation and database constraints remain necessary.

Filters include `eq`, `ne`, `in`, `notIn`, comparisons and `isNull`. PostgreSQL
supports `ilike` and `tsMatch`; other engines use their `LIKE` behavior for `ilike`
and reject `tsMatch`. Order items accept `nulls: "first" | "last"`; MySQL uses a
null discriminator to implement placement.

`paginate` uses a count and an offset page. `cursorPaginate` walks the primary
key. `keysetPaginate` supports compound orderings ending in the unique primary key,
with non-null scalar ordering fields and a bounded page size. Pass its returned
cursor unchanged; do not reconstruct precise timestamps from JavaScript `Date`.
Cursors are not authorization tokens: reapply the same authorized filters on every
request. Pages are continuations, not snapshots. Use stable ordering and indexes.

For background batches use `chunkById`, especially when processing changes the
rows being read. For advanced predicates, projections and cursor limits, consult
[model query types](../src/core/database/modelQuery.ts) and
[pagination types](../src/core/pagination/index.ts).

## Relationships

Register every related model. Relationship methods accept a class or a lazy class
reference such as `() => Category` when imports are circular:

```ts
const note = await database.model(Note).findOrFail(noteId);
const category = await note.category().get(); // Category | null
const sameCategory = await database
	.model(Note)
	.query()
	.where({ category_id: categoryId })
	.with('category')
	.get();
```

Use eager loading (`with`) for lists to avoid a query per row. `withCount` adds
relation counts without loading the related rows. Other builders include
`hasMany`, `hasOne`, `belongsToMany`, through and polymorphic relationships;
[model methods](../src/core/database/model.ts) specify their keys and pivot options.
Class-reference relationships preserve the related subclass. Heterogeneous
`morphTo` maps retain less specific typing. Eager child queries do not inherit a
parent row lock. Relationships do not replace ownership checks or database RLS.

## Transactions and tenancy

```ts
await database.transaction(async (tx) => {
	const note = await tx.model(Note).findOrFail(noteId);
	await note.update({ body: 'Published' });
	// Select every other participating model/repository from tx too.
});
```

Throw to roll back. Returning a 4xx `Response` is still a successful callback, so
map business errors outside the transaction. `tx.requestRollback()` explicitly
requests rollback while preserving the callback result. Nested transactions use
savepoints on the same connection; await siblings sequentially. Do not use the
parent session while its child transaction is active or leak transaction models
outside the callback. Post-commit listener failure does not undo committed rows.

Use `tx.afterCommit` for work that must run only after commit; durable external
work belongs in an outbox written in the same transaction. SQL transactions cannot
atomically commit an email, object upload or another database connection.
For cancellation, checkout metrics, cleanup and outcome rules, see
[database sessions](DATABASE-SESSIONS.md).

PostgreSQL supports RLS tenancy with a restricted runtime role. SQLite/MySQL
support application column tenancy. Tenant-owned reads and writes must retain the
selected policy and authorized tenant predicates; a `tenant_id` column alone does
not isolate rows. Cross-owner or cross-tenant nesting rejects. Runtime credentials
must not provision roles or perform migrations. See [tenancy](TENANCY.md).

## Application migrations

Generate a file with `bunx strata make:migration create_categories`, then keep its
generated name and fill in its schema callbacks:

```ts
import { defineMigration } from '@getstrata/core/database/migrations';

export default defineMigration({
	name: '0010_categories',
	up(schema) {
		schema.create('categories', (table) => {
			table.id();
			table.string('name', 120);
		});
	},
	down(schema) {
		schema.drop('categories');
	},
});
```

Run `bun run db:migrate`; use `bunx strata migrate:status` to inspect supplied
migration history. Files live in `src/db/migrations`, tracked in
`framework_migrations`. Seed separately. Preserve applied filenames and definitions;
add a new migration for later changes. `migrate:fresh` is a destructive development
reset, not a production upgrade. Restore missing historical files before rollback.

`defineMigration` executes the accumulated schema plan after its callback resolves.
Raw `db.unsafe(...)` calls run immediately: use a later migration or explicit
`Schema.run` before data changes that depend on newly created tables. The helper
does not make DDL transactional. MySQL implicitly commits many DDL statements;
framework business transactions must not contain them.

Schema details worth deciding before migration:

- `uuid("id").primary()` uses PostgreSQL UUID, MySQL CHAR(36) and SQLite TEXT;
  it does not generate UUIDs. Supply validated strings, for example `crypto.randomUUID()`.
- `bigId()` generates 64-bit identities; `bigInteger()` is not automatically generated.
  Match foreign-key widths and handle values above JavaScript's safe-integer range.
- SQLite cannot add a column-level unique constraint with `ADD COLUMN`. Add a
  nullable column plus a separate `table.unique(...)` index. Some constraint changes
  require a table rebuild. Unsupported alterations reject rather than disappear.
- `schema.drop` uses PostgreSQL CASCADE. Use explicit restrictive SQL when dependent
  data must prevent a rollback. String length enforcement also differs by engine.

For supported constraints and explicit engine selection, see the
[schema API](../src/core/database/schema/schema.ts) and
[blueprint methods](../src/core/database/schema/blueprint.ts).

## Custom data access and engine limits

A selected model's `repository()` supplies lower-level access. `query().project`,
aggregates and `sumBy` return plain rows; grouped sum totals remain database text
or null to avoid assuming JavaScript number precision. Conditional repository
`update`/`delete` return affected-row counts. They require explicit predicates and
do not apply model fillable rules, casts, timestamps or per-row observers. Apply
model predicate scopes explicitly when using a raw repository query. Do not send
plaintext secrets into bulk writes expecting instance write hooks.

Inside an owned transaction, `lockForUpdate`/`sharedLock` support PostgreSQL and
MySQL row locks with wait/nowait/skip-locked options. SQLite rejects row locking;
its write transactions serialize instead. PostgreSQL supports locking selected
tables with `of`; MySQL rejects that option. Keep lock order consistent.
MySQL rejects `updateReturning`; it does not emulate an unlocked returned row.

Raw `execute({ text, params })` uses the selected driver's placeholders (`$1` on
PostgreSQL, `?` on MySQL/SQLite). Bind values instead of interpolating request data.
Identifiers must be trusted declared names. Select a named connection with
`database.connection("reporting")` before opening a transaction; unknown names and
cross-pool transaction switches reject.

Use UTC timestamps consistently. PostgreSQL stores instants; SQLite timestamp text
must use a consistent ISO format; the official MySQL adapter uses UTC connections.
MySQL decimals and integers outside JavaScript's safe range remain exact strings.
Use explicit domain conversion and JSON encoding. SQLite VM/file work is synchronous
under its asynchronous session interface; consider the workload's write concurrency.

Advanced construction is documented by the public [definitions](../src/core/database/definitions.ts),
[repository query](../src/core/database/repositoryQuery.ts) and
[connection contracts](../src/core/database/driverPorts.ts). Existing `createModel`
definitions and custom repositories remain supported without changing ordinary
class-model authoring. Explicit native clients own their connection cleanup.

### Independent SQLite observations

File-backed SQLite adapters optionally expose `observeReadOnly` through an isolated
read-only Bun process; deadlines include startup and cancellation waits for exit.
Private `:memory:` databases cannot use it. The MySQL URL adapter offers an equivalent
capability; pool-only construction cannot. Ordinary queries keep their existing
connection path. See the [connection contract](../src/core/database/driverPorts.ts)
for the optional capability and limits.

## Factories

`bunx strata make:factory Note` writes a factory helper for an existing model.
Its definition supplies a complete `NoteRecord`; `make()` performs no database work.
For `create()`, provide persistence from the current execution, such as
`async values => (await database.model(Note).create(values)).toObject()`.
Await creation before leaving that scope. Parent/child factory work is atomic only
when explicitly bound to the same transaction. See the
[factory API](../src/core/database/factory.ts) for states, sequences and associations.
