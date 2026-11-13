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

The [completion ledger](refactor-completion-ledger.md) maps every retained capability
to deeper executable acceptance and records intentionally retired assertions. The
25-profile health campaign cannot substitute for those workflows.

## Release readiness

Breaking API removals require the stable 3.x release line after qualification.
This guide does not certify that qualification or publication occurred. Local
archives must remain tied to their exact source and integrity receipts.

Before release, execute the bounded adapter/profile qualification inventory, review
generated route/OpenAPI/SDK snapshots, and pass the complete distribution, E2E,
smoke, and CI gates on the integrated revision. Publication and hosted deployment
remain separate decisions.

## Additional ownership migrations

- Pass an explicit coordinator to `installGracefulShutdownSignals(signals, lifecycle)`.
  Register and shut down through that coordinator. Process-wide shutdown/reset helpers
  have been removed.
- Discover modules with `createModuleDiscovery({ modulesDir | manifest }).load()` or
  `ensureModulesLoaded(options)`. Each owner caches its own immutable result list;
  builders receive that list explicitly. Global discovery configuration and preload
  side effects have been removed.
- Give each queue its own `JobRegistry`. Register factories explicitly; constructors
  do not register themselves. Queue validation does not construct a job; an admitted
  attempt invokes its owner's factory. Retry policies are copied and validated.
- Use `createCoreProviders(environment)` to capture core configuration before startup.
  Config/cache/queue factories capture settings rather than reading environment getters
  during registration. The prior `legacyCache` bridge has been removed.
- Use explicit `Mailer`/`StorageManager` instances or `createMailBindings` and
  `createStorageBindings`. Resolve their canonical tokens from
  `@getstrata/core/contracts/serviceTokens`. `resolveStorageConfig(environment)` captures
  local paths and S3 settings; constructors and operations do not select a global owner.
- Create a new `createTracingProvider(options)` for each context. Its definition is
  single-use; reuse rejects before another runtime is acquired. Exporter configuration
  is captured at declaration, and the runtime is acquired during registration. The
  context owns flush and shutdown. A kernel without that provider is untraced;
  middleware used directly requires an explicit runtime. The OpenTelemetry API context
  manager remains a process-level propagation facility, not an exporter owner.
- OIDC clients/providers own their discovery and JWKS caches. Pass a captured
  `networkPolicy: { production, allowPrivate }`; direct providers default to
  production-safe networking. Environment changes cannot alter an existing client
  or lend its cache to another owner. Global cache-reset helpers are removed.
- The unused mutable `abilityCatalog`/`configureAbilityCatalog` API is removed.
  Default role constants remain; custom ability/policy resolution belongs to the
  application guard, directory and policy ports.
- Declare repository/model construction with `defineRepository`/`defineModel` from
  `@getstrata/core/database/definitions`. Select them through the current
  `DatabaseSession`; protected clone/serialization overrides and global model
  registration are replaced by explicit construction and attribute functions.
- Starter renderers accept an explicit `StarterFeaturePlan`. Direct renderer callers
  compile raw choices with `compileStarterFeatures` first. There is no global plan cache.
  Generated signing placeholders are development-only and rejected in production.

`bun scripts/verify-starter-pairwise.ts --output=/absolute/path/receipt.json` runs the
25-profile backend generation/install/type/migration/boot inventory with bounded
concurrency and owned local databases. The generator is source code; its consumers
install packed core/bootstrap/CLI candidates. See [qualification limits](../STARTER-QUALIFICATION.md)
for install reuse, credential fixtures and the separate deeper behavioral inventory.

The integrated source includes view, queue actor/tenant transport, HTTP/security
configuration and crypto ownership. Completion requires final executable acceptance.
Use the completion ledger and exact-revision integration receipt to determine their
status. Source-level removal alone and historical health boots do not certify the
final application, package or release contract.
