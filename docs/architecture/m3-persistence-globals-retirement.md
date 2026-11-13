# Persistence global retirement

This cut removes the public default, bound, named-registry and implicit repository
connection APIs. Applications select declared connections through their current
`DatabaseSession.connection(name)`. It preserves explicit native constructors,
`createDatabaseQueryProxy(pool)`, and the raw adapter transaction context.

| Previous assertion or consumer | Resulting contract |
| --- | --- |
| `defaultConnection.test.ts`: registration, global symbol storage, source/bundle default identity | Retired with the default registry; packed root/subpath/type absence is asserted instead. |
| `bindConnection.test.ts`: mutable override, reset, global symbol storage and implicit fallback/tag compilation | Retired with the bound/repository fallback APIs. Selected-session query/driver contracts remain; explicit proxy routing has its own retained test. |
| `bunSql.test.ts`: binder sets two globals | Binder assertion removed; URL validation and all explicit `createBunSqlPool` constructor tests remain. |
| `database/namedConnections.test.ts`: global registry mutation and ambient named runner | Replaced by `selectedNamedConnections.test.ts`: same-named pools isolate two owners, missing names and expired scopes reject. |
| Remaining SQLite/MySQL sections in that file | Preserved as `database/nativeConnections.test.ts`, including driver lifecycle/transaction assertions. |
| Production `src/db/connection` singleton used by test preload and RLS inventory | Removed. `tests/helpers/fixtureDatabase.ts` owns the deliberately shared per-worker test fixture without publishing/registering a default or callable proxy. The unreferenced `clearPendingAuditLogs` test helper is retired. |
| Fixture ping, reconnection and deliberate replacement tests | Retained against explicit private fixture owners; add no-acquire close, cleanup failure and gated overlapping-transition ownership assertions. |
| Implicit/test-overridden live-role inspector | Removed. The guard takes explicit environment and inspector; URL denylist precedes inspection, missing/malformed/query-failed/unsafe roles fail closed for applicable targets. |

Private fixture replacement rejects overlapping transitions. Closing during an
accepted replacement joins that transition and closes its new handle; it blocks
synchronous acquisition during the handoff. Failed closure retains the owned
handle and exposes the failure rather than acquiring a replacement. This sharing
is test infrastructure, not an application database registry.

Unused fake transaction bind/reset helpers have no replacement. Current role and
RLS inventory assertions, fixture schema/audit behavior, explicit raw adapter
routing and pool cleanup remain required. Production package exports and entry
inventories drop retired paths; clean builds and packed artifact checks must also
prove stale distribution files are absent.

Schema compilation now also requires an explicit driver or a scoped
`runWithSqlDialect` invocation; mutable overrides and environment fallback are
retired. Authentication outcomes, typed container keys, and owned route inventories
are documented in the target API migration guide. These source changes do not
by themselves establish complete distribution or release qualification.
