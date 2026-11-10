# Application-owned SQL sessions

`createDatabaseBindings` declares one application resource per named connection.
Starting the application opens those resources; stopping it drains admitted work
before closing them. Configuration is copied and validated before native effects.
The bindings do not read environment variables.

```ts
import { createDatabaseBindings } from "@getstrata/core/database/bindings";
import { DATABASE_SESSION_TOKEN } from "@getstrata/core/database/tokens";
import { createApplication } from "@getstrata/core/runtime/application";

const app = createApplication({
  providers: [],
  services: createDatabaseBindings({
    default: "primary",
    connections: {
      primary: { driver: "sqlite", filename: "./application.sqlite" },
    },
  }),
});

await app.start();
try {
  await app.run(async (scope) => {
    const db = scope.resolve(DATABASE_SESSION_TOKEN);
    await db.execute({
      text: "CREATE TABLE IF NOT EXISTS purchases (id INTEGER PRIMARY KEY)",
      params: [],
    });
    await db.transaction(async (tx) => {
      await tx.execute({ text: "INSERT INTO purchases (id) VALUES (?)", params: [1] });
      tx.afterCommit(async () => {
        await db.execute({ text: "SELECT id FROM purchases", params: [] });
      });
    });
  });
} finally {
  await app.stop();
}
```

PostgreSQL uses `{ driver: "pgsql", url }`; MySQL uses
`{ driver: "mysql", url }`. Both accept a positive integer `max` pool size.
PostgreSQL also accepts nonnegative finite `idleTimeout`, `maxLifetime` and
`connectionTimeout` durations in seconds. Defaults follow the native adapters.
Select another configured connection with `db.connection(name)` before entering a
transaction. A transaction cannot switch pools.

`DatabaseSession`, `TransactionSession`, `SqlStatement`, connection options and
capability types are exported from `@getstrata/core/database/session`.
SQL text uses the selected driver's placeholders. The framework captures the
statement text and parameter array before dispatch; native bind-value codecs
retain their existing semantics. Dialect and capability descriptions are frozen.

## Transaction work and outcomes

Each transaction owns one physical connection, or one serialized SQLite slot.
Nested `tx.transaction` calls use savepoints on that same connection. Parent and
sibling transaction methods reject while a child savepoint is active. A child
that rolls back completely can be caught while the healthy parent continues.

An actual SQL rejection marks its branch for rollback even when application code
catches or ignores the query promise. A normal callback failure is rethrown with
its original identity after confirmed rollback when no additional failure needs
reporting. Calling `tx.requestRollback()` explicitly requests rollback and preserves
the callback's result, including `undefined`, `false`, zero and an empty string.
Returning an error-shaped value does not request rollback.

Only SQL that preserves the framework-managed transaction belongs inside these
callbacks. Explicit transaction-control SQL and MySQL statements that implicitly
commit, such as DDL, are unsupported there. Run schema work through an execution
session outside a transaction. The session API is not a SQL parser or sandbox;
its disposition reports describe the framework's control protocol under this
statement contract.

Commit waits for admitted descendant operations and their pre-commit cleanup.
A captured outer command scope's `spawn` creates a sibling, so it cannot borrow a
transaction session. Execution and transaction capabilities reject use from the
wrong run or after their owning work closes. Ignoring a waiter does not detach
the underlying query or allow shutdown to close its connection early.

Cancellation stops new admission. It does not pretend that an already admitted
native query stopped, or automatically roll back successful work merely because
its caller's signal changed. Explicit acquisition cancellation and metrics are
available only when the selected driver advertises those capabilities; SQLite
and MySQL reject unsupported acquisition options before checkout.

## After commit and failures

`tx.afterCommit(work)` registers ordered work. Successful child savepoints promote
their callbacks; rollback discards them. The outer transaction invokes callbacks
only after confirmed commit and safe connection release. Each callback's actual
descendants finish before the next callback starts or the transaction promise
completes. An observer failure stops later observers and reports committed data;
it does not retry business work or claim rollback.

Persistence failures use the canonical `PersistenceError` from
`@getstrata/core/database/errors`, also exported by the core root. Its `code` is
transport-neutral. Transaction failures can expose `data` as `not-started`,
`committed`, `rolled-back` or `unknown`, plus a tagged observation of the actual
callback result. Opaque `cause` and `result` fields are non-enumerable and preserve
payload identity. HTTP adapters alone choose response status and safe messages.

A missing COMMIT acknowledgement is uncertain even if a later ROLLBACK command
receives a reply: that rollback might have done nothing after a successful commit.
Safe connection disposal and known data disposition are separate facts. A cleanup
failure remains an execution failure even if the transaction waiter is caught;
the application retains ownership when safe release cannot be proved. There is
no automatic COMMIT retry or transaction replay.

## Refactor scope

This establishes explicit SQL sessions and native transaction ownership. Existing
model and repository globals, tenancy/RLS composition and event/outbox integration
move to these owners in the following persistence milestones. Existing starter
and HTTP/worker composition are not yet claimed to use this API end to end.
