# Strata and strata-shop production audit

Date: 2026-10-03. Published packages: `@getstrata/bootstrap`, `@getstrata/cli`, `@getstrata/core` 1.1.9. Local framework source: commit `179a8b6`. Runtime for local reproductions: Bun 1.4.2 on macOS. Postgres and Redis are local Docker services.

## Judgment

The shop uses Strata broadly and has already generated valuable framework feedback. Strata has a credible application-framework foundation and uses important native Bun capabilities. Neither repository currently provides evidence sufficient to claim readiness for a high-volume, critical commerce system serving millions of users. Four new reproductions fail on the published release. Treat them as release blockers for the affected guarantees, not as hypothetical scaling worries.

Using every feature is the wrong goal for one product. A retail app does not need every relationship type, enterprise identity provider, or database dialect. Every supported feature does need an appropriate framework acceptance application. Product features should exercise framework mechanisms naturally; importing an API is not production evidence.

This is a source and failure-mode audit, not a complete security assessment or a production capacity benchmark. No distributed soak test, independent penetration test, failover exercise, or production telemetry was supplied. No throughput number or readiness percentage is asserted.

## What the shop actually exercises

- HTTP/modules/providers: published route builders, kernel middleware, discovery, DI, services, controllers, policies, resources, JSON and HTML error contracts.
- Data: Postgres, real RLS roles, tenant context, repositories/models, belongsTo/hasMany eager loading, migrations, validation, integer prices, constraints, ETags and conditional requests.
- Identity: cookie sessions with CSRF, opaque-token and JWT guards. MFA, verification, SCIM, GitHub, OIDC and SAML routes are present, but complete external-provider journeys and repeated adversarial tests are not demonstrated by the current commerce smoke suite.
- Effects: model events, listener/job discovery, Redis workers, notifications, SMTP configuration, signed URLs, Stripe subscription synchronization, signed outbound webhooks and SSRF-aware delivery.
- Frontend/operations: HTMX storefront/admin, official React hybrid scaffold, SPA build/serving, API-only OpenAPI, storage/upload adapters, logging, metrics, scheduler and production secret guards.

The current catalog/cart/checkout tests are valuable local integration proofs. They predominantly use array cache, small fixtures, one app process, and short scenarios. The Redis checks use real workers but do not simulate worker death. The old rollback check called the service directly rather than sending the failing operation through HTTP. Those distinctions hid important failures.

Not deeply exercised here: cursor pagination at large row counts, relation/query complexity and query budgets, cross-process cache invalidation, S3/CDN operation, scheduler leadership and overlap, client-disconnect cancellation, telemetry exporter outages, safe rolling deploys, backup restoration, actual payment lifecycle and provider event ordering. SQLite/MySQL and other layers belong in separate generated-app acceptance suites rather than this Postgres shop.

## Reproduced findings on published 1.1.9

### P1 — HTTP errors can commit partial checkout state

Run `bun run scripts/framework-http-rollback-repro.ts`.

An observer throws after the second order item is inserted. The real `/api/v1/orders` endpoint returns 500. Observed database state is one order, two items, one notification, stock sum 9 instead of the original 10, and both cart rows still present. Expected: no order/items/notification, stock sum 10, cart preserved.

The interaction is between the shop's assumption of an atomic checkout boundary and the framework transaction/error contract: `runWithTenantDatabase()` reuses an active connection without a savepoint; controller error handling converts a thrown exception into a Response; the outer tenant transaction therefore commits. An SQL error that aborts a Postgres transaction has different behavior, so not every HTTP 500 demonstrates this failure.

Owner: framework transaction/HTTP integration, with shop adoption of the clarified transaction API. Upstream must provide and document a safe business transaction boundary that composes with request RLS and error mapping, such as an explicit savepoint/rollback-only contract. Do not blindly roll back every intentionally returned 4xx response. Regression tests must go through the real kernel, for both HTML and JSON, with failure after writes. Bun already supports savepoints; preserve that capability in the framework contract.

This invalidates the earlier broad claim that checkout was proven atomic through HTTP. The direct-service rollback regression remains valid, but is narrower.

### P1 — Worker death loses a popped Redis job

Run `bun run scripts/framework-queue-crash-repro.ts`.

The test uses a unique Redis namespace, dispatches one published-framework job, starts a disposable child worker, waits until handle begins, then kills that child. Observed: zero pending jobs and no remaining queue keys. The job never finished and is absent from recoverable queue state.

Owner: framework queue. `BRPOP` removes work before completion. There is no reservation/acknowledgement, processing lease, or recovery path. In-process recursive retries help thrown errors; they cannot help a killed process. Add durable reservations and crash recovery, bounded execution/cancellation, persisted retry schedules, and dead-letter visibility. Guarantee at-least-once delivery and require idempotent handlers rather than claiming exactly-once effects. Redis documents the reliable-queue pattern using a processing list and acknowledgements: [LMOVE](https://redis.io/docs/latest/commands/lmove/).

### P1 — Nested tenant changes leave the wrong database tenant

Run `bun run scripts/framework-tenant-scope-repro.ts`.

An outer scope uses tenant 1 and an inner scope tenant 2. After the inner scope returns, `currentTenant()` is 1 but Postgres `app.tenant_id` remains 2 on the active transaction. The reproduction only reads connection settings; it does not alter tenant records or demonstrate an externally exploitable request.

Owner: framework tenancy. Either reject tenant switching within an active transaction or restore the database setting and related bypass state correctly. Async context alone is insufficient. Add success, exception, nesting and concurrent-request tests against a real restricted Postgres role.

### P1 — Metrics retain one sample per request forever

Run `bun run scripts/framework-metrics-memory-repro.ts`.

100,000 duration observations for one route retain 100,000 array entries. This is a structural retention probe, not a measured HTTP load benchmark. `PrometheusRegistry` stores unbounded duration arrays and reduces all historical samples when rendering. Long-lived Bun processes will accumulate memory and scrape work with traffic volume.

Owner: framework telemetry. Use bounded aggregates/histograms, normalized registered route labels, and appropriate count/sum/buckets. Current output cannot derive request latency percentiles from a duration sum alone. [Prometheus instrumentation guidance](https://prometheus.io/docs/practices/instrumentation/), [histograms](https://prometheus.io/docs/practices/histograms/).

All four new reproductions intentionally exit nonzero on this release. Fixture-backed reproductions clean their data in finally; the queue probe kills only its own worker and deletes only its unique namespace. `bun run check` passes. No framework code was vendored and no node_modules file was modified.

## Important source findings not measured under production load

### Framework mechanisms

1. Redis cache calls `KEYS` in `enforceMaxEntries()` on every set, as well as prefix invalidation, size and clear. Matching a prefix still scans the Redis database. Tag bookkeeping is partly process-local and TTL expiration does not clean all metadata. Single-flight cache fills are local to each process. These need large-keyspace and multi-process tests; merely replacing KEYS with SCAN does not solve eviction and invalidation races. [Redis explicitly advises against KEYS in regular application code](https://redis.io/docs/latest/commands/keys/).
2. Deferred model events are held in memory and published after commit. Death after commit but before queue publication loses the event. Listener failure may also propagate after the business data has committed. A durable outbox or equivalent recovery contract is missing for critical effects. The framework should supply generic transaction/event mechanics; the shop chooses which business events are durable. [AWS transactional outbox guidance](https://docs.aws.amazon.com/prescriptive-guidance/latest/cloud-design-patterns/transactional-outbox.html).
3. Tracing constructs Unix-nanosecond fields from process-relative `performance.now()`, creates a span ID different from the response span ID, marks spans OK irrespective of response status, and starts one unbatched export per request when enabled. Standard propagation, wall-clock timestamps, error classification, sampling, bounded batching and shutdown flushing need work. Use a maintained OTel SDK/collector where compatible. [OpenTelemetry JS instrumentation](https://opentelemetry.io/docs/languages/js/instrumentation/).
4. Throttling uses separate INCR and EXPIRE operations. Interruption between them can leave a bucket without TTL. Memory fallbacks are process-local and need bounded pruning. The current broad request-path key also needs route cardinality review. Add atomic Redis operations and multi-instance enforcement tests.
5. Scheduler tasks have no built-in cluster leadership or overlap exclusion in the reviewed runner. Multiple scheduler processes need explicit deployment ownership or distributed locks. The shop's low-stock task lacks a per-tenant scope, so a fresh RLS scheduler invocation can silently read no products.
6. The public-read feature flag also governs anonymous tenant-header behavior and is rejected by production guards. A public retail catalog needs a safe, explicit public-route policy and trusted tenant resolution independent of development tenant-selection flags. This is a framework/product-fit limitation rather than evidence of an exploitable vulnerability.
7. The server-HTMX wrapper exposes few native Bun server options and does not apply the configured body size as a Bun-level limit. The middleware checks declared Content-Length; chunked/missing-length bodies need an actual consumption limit. Generated-shop shutdown closes the DB before stopping HTTP and exits without demonstrating request/worker drain. Framework App shutdown uses stop(true), which is also not a graceful active-request proof.

### Shop commerce and deployment

1. `migrate()` calls `seed()` unconditionally; seed can create the publicly known demo shopper/admin credentials on an empty production database. Demo seeding must be explicit and development-only before deployment. This is app-owned deployment behavior inherited from the current starter (`packages/strata-starter/src/renderRuntime.ts` also emits migrate followed by seed). The generator should offer a safe production default, and the shop must stop shipping its demo provisioning into production.
2. Pending orders reserve inventory, but payment capture, cancellation, reservation expiry, refunds and recovery do not exist yet. Subscription billing is not product-order payment processing. Concurrent same-cart suppression is not a durable request idempotency contract across cart changes and retries.
3. Order history reads every matching order. Commerce migrations lack workload-specific tenant/user/order-item indexes; foreign keys do not automatically index referencing columns. Add pagination and choose indexes from real RLS query plans, not an arbitrary index checklist. [PostgreSQL constraints](https://www.postgresql.org/docs/current/ddl-constraints.html).
4. Stripe event deduplication is tested sequentially. The shop checks for an event before applying side effects, then inserts the dedupe row. Concurrent duplicates and out-of-order distinct events need tests and an atomic/idempotent app policy. Unknown plan/status mappings currently have permissive defaults. Stripe documents both duplicate deliveries and event ordering limitations: [Stripe webhooks](https://docs.stripe.com/webhooks).
5. Local storage and a mutable runtime image tag are useful development defaults, but multi-replica deployment needs shared object storage, pinned runtime/image provenance, readiness, connection budgets, trusted proxy configuration, backup restoration, secret rotation and rollback exercises.

## Laravel-inspired, Bun-native design

Good choices already present: native Bun.serve routes, standard Request/Response, async services, Bun SQL pools, native RedisClient, Bun.password's async auth helpers, Bun S3Client, fetch/streams, TypeScript interfaces and module imports, and AsyncLocalStorage for request/tenant context. No second backend framework is required by the shop.

Classes, controllers, policies, jobs and migrations are not PHPisms by themselves. Keep them when they improve ergonomics. Keep direct SQL/repository access as a documented escape hatch for locks, bulk operations, projections and query plans. Do not force ORM hydration for every read.

Avoid request-lifetime assumptions in process-lifetime objects, global facade state as the only dependency path, stringly typed model relationships/route casts, synchronous I/O or CPU work hidden in model casts, and custom substitutes for standards that have established libraries. The model's `hashed` cast uses `Bun.password.hashSync()` while the ordinary auth helper uses the async API: an optional framework path can stall a long-lived request process. The shop currently hashes explicitly and does not use that cast.

The framework also hardcodes `free|pro|enterprise` and plan-based throttle multipliers in core TenantContext. That crosses the desired mechanism/commerce boundary. Generic tenant identity/context belongs in core; entitlement/limit policy and product plan names should be supplied by the app.

Bun server options should remain accessible through supported framework configuration: streaming/cancellation, timeouts, WebSocket upgrade hooks when a product needs them, request limits and Linux reusePort. Multiple replicas behind a load balancer are also valid; lack of reusePort alone does not prevent horizontal scaling. [Bun HTTP](https://bun.sh/docs/runtime/http/server), [Bun SQL](https://bun.sh/docs/runtime/sql), [Bun process clustering](https://bun.sh/guides/http/cluster).

Laravel itself documents lifetime problems under Octane and queue retry/visibility semantics. Copy the developer experience and mature reliability guarantees, not PHP-specific syntax or the assumption that a process is reset after each request. [Octane](https://laravel.com/docs/12.x/octane), [queue expiration/timeouts](https://laravel.com/docs/12.x/queues#job-expirations-and-timeouts).

## What would count as million-user evidence

Registered users, monthly active users, concurrent requests, request rate, hot-SKU contention and background job rate are different measures. Define the traffic distribution, dataset, regions, hardware, availability/error-budget target and latency SLO before setting capacity goals.

The checked-in framework k6 scenarios use 5 virtual users for 30 seconds and 10 for 45 seconds, with sleeps and mostly health/auth pages. They are useful smoke recipes, not commerce scale evidence. No completed results were found; the larger script also hardcodes a demo password that does not match this shop. Fixed-VU tests can reduce arrival rate as the service slows, hiding overload; add open arrival-rate scenarios. [k6 open versus closed models](https://grafana.com/docs/k6/latest/using-k6/scenarios/concepts/open-vs-closed/).

Suggested promotion gates, not measured results:

1. Correctness: all four reproductions pass; fail-after-write HTTP tests cover JSON and HTML; worker death/ack/retry tests preserve every expected durable event; tenant state never leaks across scopes.
2. Cross-process behavior: run at least three app replicas and two workers against shared Redis/Postgres. Verify cold-cache bursts, cache invalidation, token revocation, throttles, concurrent checkout and scheduler ownership.
3. Representative data: test both high-tenant-count and large-tenant distributions with realistic catalog, users, sessions, carts, orders and audit rows. Inspect EXPLAIN ANALYZE, query count, lock waits and pool wait times. Define a connection budget across every app and worker process.
4. Workload ladder: ramp open arrival rates through catalog browse, auth, cart mutation, checkout and signed delivery; separately stress hot products and noisy tenants. Record p50/p95/p99, errors, event-loop delay, RSS/heap, CPU, GC, Redis latency, queue age, retries and DB saturation.
5. Failure and soak: kill workers/app processes around write/commit/publication/ack boundaries; interrupt Redis/Postgres/mail/telemetry; test slow clients and cancellation; run sustained traffic long enough to detect memory/metadata growth. Use a separate controlled environment and generator so local dev contention is not mistaken for production capacity.
6. Operations: prove rolling deployments and migrations under traffic, restoration from backup/PITR, bounded shutdown, external-provider flows and independent security review.

Only then describe capacity in terms of the measured workload and environment. A useful framework can mature into that system; a Laravel-like API and a fast Bun HTTP baseline do not establish those guarantees on their own.
