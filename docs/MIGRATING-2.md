# Migrating applications from Strata 1.x to 2.x

This guide consolidates the application changes required by the 2.x production work. It describes the current repository contracts, including changes merged **after 2.2.0**. It is not a claim that every change below is available in 2.2.0. Before deploying, select a published release containing the contracts you adopt, inspect its release notes and generated output, and install compatible core, bootstrap and CLI versions together. Do not copy unreleased framework implementation into an application or patch installed packages.

Application prices, plans, inventory, payment reconciliation and business event selection remain application responsibilities. Framework upgrades do not implement those rules or prove a deployment's capacity.

## 1. Inventory and compare generated code

Record your installed versions, lockfile, database migration history, enabled auth/tenancy layers, queue transport, worker entrypoints, cache namespace and pending recovery data. Back up SQL and Redis using the deployment's tested restore procedure before changing persistent infrastructure.

Generate a **disposable** application using the selected published `create-strata` version and the same layers/frontend mode. Compare its bootstrap, providers, models, migration runner, auth routes, HTTP/worker/scheduler entrypoints and scripts with your application. Merge those shapes deliberately; do not regenerate over business code or replace existing migrations with a fresh scaffold. Use public subpath imports and retain a frozen lockfile. See [starter output](STARTER.md) and [package contracts](PACKAGING.md).

Look specifically for copied config stores, constructor-only repository classes, manual model aliases, unawaited startup/discovery calls, synchronous password hashing, broad controller dependencies, unsafe route/model casts, custom signal handlers and copied auth/crypto helpers. Preserve real custom repositories and application queries.

## 2. Apply additive schema changes first

Use application file migrations and the published Schema API. Existing inline migration applications must first adopt the [file migration runner](BUILDING-APPS.md#adopting-file-migrations-from-a-legacy-inline-migratets) without losing rows or inventing migration history. `CREATE TABLE IF NOT EXISTS` alone does not verify that an existing table has the expected columns and constraints: inspect and reconcile the live schema. Never use `migrate:fresh` on production data. Do not point the framework's monorepo fixture runner at a product database.

**Failed-job identity is required before upgrading to the runtime/CLI release that introduces it.** Add nullable `failed_job.job_id` through a new numbered migration for every existing application, including local and list-queue applications. New generated schemas already include it. Old writers and existing rows remain compatible with `NULL`; do not infer historical identities from payloads. Use the [migration and replay procedure](QUEUES.md#failed-job-identity-migration-and-replay), which includes an official Schema up/down example.

**The SQL outbox is opt-in.** Package installation does not create its tables or activate durable listeners. Add an application migration using `createOutboxMigration` from `@getstrata/core/events/outbox`, with the selected SQL driver and RLS enabled only for Postgres RLS applications. Apply it through the migration owner and grant the runtime role the documented access to both tables. Configure the complete listener registry before starting writers or workers. See [durable events](BUILDING-APPS.md#durable-transactional-events-opt-in-sql-outbox) for schema, payload/version, delivery and replay contracts.

Keep migration credentials separate from the runtime role. Postgres RLS runtimes must be neither superusers nor `BYPASSRLS` roles; a migration bypass scope does not grant DDL permissions. Apply migrations once per deployment, separately from application admission. Role provisioning serialization does not serialize arbitrary schema migrations. See [database](DATABASE.md) and [tenancy](TENANCY.md).

## 3. Adopt awaited startup and declarative models

Merge the current generated provider list and entrypoints. Await `createAppContext`, `createAppDependencies`, low-level provider phases and discovery before admitting requests or constructing workers. Context getters no longer trigger hidden startup. Register cleanup when acquiring resources so failed startup can dispose them; keep database closure after its consumers. Use explicit manifests for bundles and retain custom DI factories. Malformed or duplicate discovery exports now fail startup instead of disappearing. See [discovery](DISCOVERY.md).

Use the official `ConfigStore`, `ServiceContainer` and typed `createServiceToken` contracts. Inject only the controller dependencies it consumes. Remove casts only where the public route/model/DI signatures support the actual values; replacing a cast with an inaccurate record type is not a migration. See [typed application contracts](BUILDING-APPS.md).

Ordinary models extend `defineModel(table)` with typed `defineTable` metadata. Await `discoverModels`, or use `bootModels` with static imports. Default repository binding and relationship-name registration belong to the framework. Keep `registerModelRepository` for custom query behavior or explicit connections; retain deliberate string aliases where needed. Declaring a column does not make it fillable. Existing manually registered models remain supported. See [declarative binding](DATABASE.md#declarative-model-binding).

Model `create`, `save` and `update` await write casts; construction and hydration do not hash passwords. Remove application copies of hashing used to compensate for synchronous casts, but do not remove hashing from an independent authentication/import flow without checking its API contract. Existing-instance `save` writes changed fields. Projections return selected records rather than complete model instances. Direct SQL, bulk operations and explicit repository queries remain supported escape hatches whose casting, event and completeness contracts the caller must handle. See [database model contracts](DATABASE.md).

## 4. Place errors outside business transactions

Use `runInTransaction` around business writes that must succeed together. Framework repositories resolve the active connection; nested calls use savepoints. Keep error-to-HTTP conversion outside that callback: returning a 4xx `Response` is a successful callback and does not request rollback. Observer or SQL failures must escape the transaction before a response is built. Rolled-back writes must not leave deferred model events behind.

Do not switch tenants within an active transaction or run concurrent sibling savepoints. Same-tenant nesting is supported and restores bypass state. Explicit custom repository connections remain the caller's responsibility. Background jobs and scheduled tenant work need individual `runWithTenantDatabase` scopes; a worker process is not automatically a tenant scope. See [transaction and tenant scope rules](BUILDING-APPS.md#business-transactions-and-request-tenancy).

Public access policy is separate from development tenant headers. Use the official public wrappers and a trusted-host resolver through `CORE_PUBLIC_TENANCY_TOKEN`. Multi-tenant domain approval belongs to the application; unknown hosts fail closed, and forwarded hosts require configured trusted immediate proxies. Anonymous production requests cannot select a tenant through arbitrary headers. See [tenancy](TENANCY.md).

## 5. Convert queues deliberately

Redis lists remain the default. Setting `QUEUE_REDIS_TRANSPORT=streams` activates the consumer-group transport; it does not convert existing list data. Follow [the queue rollout](QUEUES.md): stop all producers and workers, drain/recover legacy processing reservations, then run the bounded `migrateLegacyQueueToStreams` helper with explicit maintenance acknowledgement. Preserve SQL failed-job records. The maintenance flag asserts operator coordination; it is not a distributed deployment lock.

Streams require Redis 6.2+ and the documented ACLs. Use the qualified non-sharded deployment shape; Redis Cluster is not qualified. Configure persistence, replication and no eviction for unfinished work. Do not trim live streams, delete recovery namespaces or run destructive-pop workers alongside recovering workers.

New Streams workers provide stable logical IDs, persisted retry schedules, optional deadlines and opt-in cooperative cancellation. Drain older workers before admitting envelopes using those contracts. Older workers cannot promote the new retry schedules or enforce their controls. Do not roll workers back while incompatible unfinished work remains. Cancellation/deadlines do not undo an external effect or forcibly terminate JavaScript.

Manual failed-job retry must await successful admission before deleting the SQL record. When `job_id` is present, use the queue's replay capability to preserve it; unsupported transports reject and retain the record. Legacy rows without identity use normal dispatch. Direct `FailedJobService.retry` callers must supply an awaited admission callback. See [failed-job replay](QUEUES.md#failed-job-identity-migration-and-replay).

All delivery remains **at least once**, including recovery and manual replay. Use durable business deduplication. A stable job ID helps identify repeats but does not make SQL effects and Redis acknowledgement one transaction. Local queues remain process-local and are not distributed substitutes.

## 6. Activate durable effects and shared caching

Distinguish synchronous in-process hooks from durable listeners. For recoverable effects, publish versioned events through the business transaction into the SQL outbox and run a separate leased worker. Durable listener effects must not run inside the business commit response. Keep business event names and effect selection in the application; handlers must tolerate replay.

For model cache invalidation, configure `createModelCacheInvalidationListener()` alongside business listeners in **one complete outbox registry**, then activate `registerInvalidateCacheOnModelWriteListeners(eventBus, { outbox })` after discovery and before admission. Wrap supported row writes in framework transactions. Direct SQL/bulk callers must publish required invalidation intents explicitly. A package upgrade alone leaves the compatibility queue listener's durability limits unchanged. See [recoverable invalidation](BUILDING-APPS.md#recoverable-model-cache-invalidation).

The shared Redis cache format requires a [cold-cache rollout](REDIS-CACHE.md#upgrade-from-the-legacy-redis-driver). Drain old cache readers/writers/invalidators, deploy all replicas with consistent namespace/capacity/coordination settings, and budget for cold-fill load. Cleanup must target only legacy cache keys through bounded maintenance scanning, excluding the new format; never delete the entire application namespace. Application operations need neither `KEYS` nor `SCAN`.

Generation fencing and shared fill leases prevent stale publication after invalidation, but durable delivery lag can still expose stale cached values. Use bounded TTLs and bypass cache for authoritative financial decisions. Cache metadata/entry bounds do not cap arbitrary payload sizes or prove a deployment's throughput.

## 7. Adopt HTTP, telemetry and shutdown controls

Keep framework handler composition while using the typed native Bun server options. Review actual body-consumption limits, streaming responses, request cancellation and WebSocket fallback contracts instead of relying on `Content-Length` alone. Native admission errors and errors after response headers are sent have different response boundaries. See [native HTTP](NATIVE-HTTP.md).

Use `LifecycleCoordinator` in custom entrypoints: stop admission, drain handlers/workers, flush telemetry, then close infrastructure. Provider cleanup has explicit drain/flush/close phases. Configure `SHUTDOWN_TIMEOUT_MS` and a supervisor termination grace that allows it to complete. Custom outbox runners own their abort signal and must await the outbox instance's `work({ signal })` before disposal. Forced termination can leave recoverable work and cannot interrupt blocked JavaScript. See [lifecycle](LIFECYCLE.md).

Adopt the generated `tracingProvider` and maintained OpenTelemetry runtime rather than copied propagation/export code. Configure sampling, bounded export queues, exporter timeouts and shutdown flushing. Monitor saturation and exporter outages; do not log secrets. See [tracing](TRACING.md). Preserve bounded route-template labels in metrics; unknown paths must not become unbounded labels.

Use the [distributed scheduler](SCHEDULER.md) ownership contracts for multi-runner deployments. Occurrence identity and renewable leases reduce overlap; owner death can still repeat an effect. Scheduled handlers require application idempotency.

Distributed Redis throttling must fail in a controlled way when Redis is unavailable rather than silently becoming process-local. Bucket identities change in 2.x, resetting existing windows. Generic app-owned quota injection and bounded memory pruning remain separate pending framework work; this guide does not present them as completed APIs. See [production throttling](PRODUCTION.md).

## 8. Preserve auth, seed and API contracts

Replace copied auth helpers with the selected release's generated shape. Preserve exact string-`true` semantics for `FEATURE_OAUTH`, `FEATURE_BILLING` and `FEATURE_SAML`; official cookie/signature helpers; `sealOidcPkceCookie` / `readOidcPkceCookie`; and GitHub's signed query state from `createOAuthState`. Do not substitute `createOAuthStateCookie` for that query value. Lowercase email for SSO lookup and preserve JSON browser SSO failures. See [auth](AUTH.md) and [integrations](INTEGRATIONS.md).

Remove unconditional demo seed calls from existing migration/reset entrypoints. Generated migrations do not seed automatically; explicit demo seeding is development-only and rejected in production/staging. Existing known accounts are not removed by an upgrade: audit, rotate or disable them through an explicit administrative procedure. Secure first-admin provisioning remains a separate F12 deliverable; there is no new provisioning command to assume in this migration. Supply an application-owned secure procedure until that feature is released.

OpenAPI describes API routes only. Keep HTML storefront/admin routes out of the spec and preserve the official hybrid SPA serving shape. Generate and check OpenAPI after route changes; build the SPA when its source or generated serving integration changes.

## 9. Rehearse deployment and rollback

Rehearse the selected upgrade against both a disposable fresh database and a restored, populated prior-version fixture, including pending orders/jobs/outbox deliveries. Verify installed public packages, not local framework links.

1. Back up and verify the restore path; stop admission and drain incompatible writers/workers before queue conversion or cache cutover.
2. Apply additive schema migrations with the migration owner, including failed-job identity before new runtime/CLI writers. Apply opt-in outbox schema/grants before activation.
3. Deploy compatible generated startup, registry and cleanup shapes. Check dependency readiness, runtime roles, trusted hosts/proxies, secrets and Redis ACLs before admission.
4. Perform coordinated queue conversion/cache cutover where selected, then resume workers and traffic. Monitor queue age, quarantine/failed jobs, outbox lag, pool waits, cache fills, exporter saturation and reconciliation failures.
5. Verify auth/tenancy, transaction rollback, cross-process invalidation, queue recovery/replay, scheduled ownership, shutdown and API-only OpenAPI using the application's acceptance suite. Run its type/lint/test checks, schema upgrade checks, frontend build and relevant commerce verifications. For strata-shop these include `bun run check`, `openapi:generate`, `openapi:check`, `db:migrate`, `frontend:build` and the affected `verify:*` scripts.

Prefer rolling back binaries while leaving compatible additive columns in place. Dropping `failed_job.job_id` loses recovery identity and requires stopping new readers/writers. Do not drop undelivered outbox data or downgrade workers that cannot process current pending schedules/control envelopes. Restoring backups can repeat external effects; reconciliation and deduplication remain required. Mixed cache generations cannot share an invalidation contract.

Repository tests are evidence for mechanisms, not a millions-of-users claim. Capacity discovery, a selected-workload soak, dependency-outage qualification, backup/PITR restoration, provider sandbox tests and independent security review remain deployment promotion gates. Record unresolved findings and block promotion on critical failures.
