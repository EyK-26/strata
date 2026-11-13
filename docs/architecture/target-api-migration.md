# Target API migration

This refactor intentionally changes the framework API. No compatibility registry
or string service-key fallback is provided.

- Compose services with `createServiceToken<T>()` and the application service graph.
  Configuration keys remain strings; service identities are opaque tokens.
- Select persistence through the current application/execution session. Explicit
  native pools and `createDatabaseQueryProxy(pool)` remain supported. Schema and
  migration code selects its driver explicitly or enters `runWithSqlDialect`.
- Await `PolicyGate.allows` or `PolicyGate.authorize` and pass the actor explicitly.
  Only the boolean `true` grants access. Domain policy denial maps to HTTP 403;
  operational failures remain errors. Typed policy maps support custom actions.
- Guards implement `authenticate` and return an `AuthOutcome`: absent, invalid,
  authenticated, or error. Invalid supplied credentials cannot fall back to a
  guest or another mechanism. Account lookup must match the authenticated identity.
  Custom account adapters throw `AuthAccountNotFoundError` for an expected miss;
  database failures must remain operational failures.
- Use `compileRouteMap`, `composeRouteMaps`, and `getRouteInventory` from
  `@getstrata/bootstrap/routePlan`. Object spreads intentionally do not transfer
  the hidden inventory. Collisions reject before publication; inventories are
  immutable and include effective native method behavior such as implicit HEAD.
- Starter generation validates and snapshots its features before acquiring output.
  Existing paths are not overwritten. `strata.features.json` records completion,
  selected requirements, and the actual emitted inventory. The programmatic
  `reference: "work-tracker"` option emits a bounded commercial reference with its
  own `docs/WORK_TRACKER.md`.

The pairwise planning command `bun scripts/report-starter-pairwise.ts` reports
25 profiles covering 1,168 feasible pairs across 21 declared dimensions, plus
13 unsupported pairs. This inventory is not evidence that those apps were run.
The reference application's cookie/server and token/API workflows are separate
behavioral acceptance cases.

## Release readiness

Breaking API removals warrant a new major candidate, proposed as `3.0.0-rc.1`
after qualification. This document neither changes package versions nor publishes
anything. Local archives must remain tied to their source and integrity receipts.

Before release, reconcile remaining provider/configuration adapters (including
mail/storage), execute the bounded adapter/profile qualification inventory, review
generated route/OpenAPI/SDK snapshots, and pass the complete distribution, E2E,
smoke, and CI gates on the integrated revision. Publication and hosted deployment
remain separate decisions.
