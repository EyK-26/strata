# Runtime metrics

HTTP observations remain bounded and available through `createMetricsRoutes()` with no runtime collectors enabled. Production/staging requires the existing `METRICS_TOKEN` bearer authentication. Responses are private operational data and use `Cache-Control: no-store`. Invalid authorization never starts collection.

## Opt-in shared Redis queue observations

```ts
import { createMetricsRoutes } from "@getstrata/bootstrap/metricsRoutes";

const redisUrl = process.env.REDIS_URL;
if (!redisUrl) throw new Error("REDIS_URL is required");
const metrics = createMetricsRoutes({
  queue: { redisUrl, transport: "streams", timeoutMs: 1000 },
});
// Merge metrics into the existing server routes as usual.
```

Match transport to the deployed queue. Omitting it uses `QUEUE_REDIS_TRANSPORT` (legacy default `lists`). No queue is converted, consumer group created, job acknowledged, payload logged or failed-job table queried by a scrape. Apps opt in explicitly; generated defaults stay compatible until the rest of the runtime collector contracts are settled.

`readRedisQueueSnapshot(redisUrl, options)` is also exported from `@getstrata/core/queue/queueMetrics`. Each snapshot reads the three namespaced priorities. One deadline (default 1 second, configurable 1–5,000 milliseconds) covers connection establishment and all reads; the dedicated Redis client closes on success, error or timeout and does not reconnect. Concurrent authorized scrapes of one route instance share the in-progress collection. The low-cardinality renderer never includes consumer, tenant or job identities, keys, payloads or URLs.

Each priority is read atomically through one Lua invocation; the three priorities are not a single cross-priority instant. Reads use cardinalities, rank-based retry counts, at most 501 pending entries, one oldest stream entry and one retry member/score. The retry member is never returned from Lua or parsed; the queue protocol stores the envelope as that member, so its size still affects transient Redis-side work. They do not use KEYS, scan jobs, parse retry payloads or enumerate consumers. Redis documents [bounded XRANGE reads](https://redis.io/docs/latest/commands/xrange/), [ZCOUNT cost](https://redis.io/docs/latest/commands/zcount/) and [XPENDING's consumer-enumerating summary cost](https://redis.io/docs/latest/commands/xpending/); this collector uses the bounded range form of XPENDING instead. These commands still consume Redis capacity: measure scrape frequency/cost with the target deployment. Redis Cluster hash-slot compatibility is unchanged from the existing queue protocol; no new Cluster support is claimed.

## Metric semantics

- `strata_queue_collector_success`: 1 on successful collection, 0 on dependency/configuration/timeout failure. On failure all queue observations are omitted, rather than reported as empty or stale. HTTP metrics remain available with status 200; alert on this gauge as well as Prometheus `up`. With the collector disabled this gauge is absent.
- `strata_queue_unfinished_jobs{priority}`: exact retained stream/list entries plus scheduled retries, excluding quarantine and SQL failed-job records. For Streams, acknowledged entries are removed by the queue protocol; externally deleting or acknowledging entries outside that protocol invalidates interpretation.
- `strata_queue_jobs{priority,state}`: `ready`, `inflight_sample`, `retry_due`, `retry_waiting`, `quarantined`. Retry states are available only for Streams. Due/waiting is measured with Redis server time. Quarantine is protocol-invalid/dead-letter Redis state, not all handler failures recorded in SQL.
- `strata_queue_inflight_sample_capped{priority}`: Streams inflight reads return at most 500 entries. A value of 1 means `inflight_sample` is a lower bound and `ready` is unavailable/omitted. Lists use exact list cardinality and this flag is 0. Even when capped, unfinished/retry/quarantine counts remain exact. State values must not be summed into an exact total when capped.
- `strata_queue_retry_actionable_lateness_seconds{priority}`: Redis-server time minus the earliest positive retry due score, clamped to 0 when none is due. This measures promotion/cleanup lateness, not job lifetime or handler duration. Lists omit it. A zero due score is the queue protocol’s immediate cancellation-cleanup sentinel: when it is first, lateness is unavailable and omitted, while the due count remains available. No retry payload is parsed or exposed.
- `strata_queue_oldest_stream_entry_age_seconds{priority}`: Redis-server residence age of the oldest current stream ID; 0 when empty. It includes retained inflight entries. Retry promotion creates a new stream ID, so this is **not** original job lifetime or time since the initial dispatch. No age sample is exposed for lists. Scheduled retry wait time is not included in this residence age.

Priorities are fixed `high`, `default`, `low`. These are shared application-namespace gauges: if multiple processes scrape the same Redis namespace, use `max` or one designated target, **not sum across replicas**. HTTP request counters remain per process and can be summed across replicas. Snapshot reads are observational and require only access to the relevant queue protocol keys/commands, not database privileges or a tenant bypass.

The older `collectQueueMetrics()` API remains compatible. Its `failedCount` is a sample capped at 1,000 SQL failures and its pending depth semantics differ; do not treat it as an exact failed total. This new scrape deliberately does not expose that value as an authoritative gauge.

## Remaining work and promotion gates

This is the Redis observation slice of [#139](https://github.com/EyK-26/strata/issues/139), not complete operational qualification. additional SQL dialects, generated wiring remain follow-up work. A Bun pool statistic or SDK queue occupancy must not be invented when its supported API cannot observe it. Use infrastructure exporters for persistence, server connection capacity and backup health.

Tests cover both transports, empty/pre-consumer state, ready/inflight/retry/quarantine state, capped output, unchanged source state, three independent processes, wrong key types, deadline/connection cleanup and concurrent scraping. Environment-specific alert routing, thresholds, sustained scrape/load costs, multi-worker recovery and failure drills remain required before production promotion.

## Opt-in SQL outbox observations (Postgres)

```ts
import { createOutboxMetricsCollector } from "@getstrata/core/events/outbox";
import { createMetricsRoutes } from "@getstrata/bootstrap/metricsRoutes";

const outboxMetrics = createOutboxMetricsCollector({ timeoutMs: 1000, sampleLimit: 500 });
const metrics = createMetricsRoutes({ outbox: outboxMetrics });
// Register outboxMetrics.close() with lifecycle draining before closing the database.
// Queue and outbox options may be enabled together; their failures are independent.
```

This is an explicit **platform-wide** observation using the framework's existing transaction-local migration bypass. It must run outside business/tenant transactions and uses the bound runtime connection with SELECT access to the installed outbox schema; no administrative URL, superuser or BYPASSRLS role is needed. It never invokes a listener, writes a delivery, loads event payloads or enumerates tenants/listeners. The collector is initially Postgres-only: opting in on SQLite/MySQL fails with an unavailable signal rather than emitting zero. Their outbox delivery mechanisms remain supported and unchanged.

`sampleLimit` is 1–1,000 (default 500). One SQL snapshot, using database wall-clock time, reads at most limit+1 records from each of six indexed state ranges. Completed history is excluded. Existing `(status,available_at,event_id,listener_name)` and `(status,lease_until,event_id,listener_name)` indexes are required; the standard outbox migration already creates them. No schema change is needed. Real restricted-role RLS `EXPLAIN ANALYZE` regressions with 20,000 completed and 1,000 pending deliveries verify index seeks and capped row reads. Keep database statistics current and measure the plan/scrape cost against your production distribution.

- `strata_outbox_collector_success`: 1 on success; 0 on timeout, missing schema, unsupported dialect or collection failure. Failure omits all outbox observations, preserves HTTP and any successful queue observations, and logs no database error text.
- `strata_outbox_deliveries_sample{state}`: capped count for `pending_due`, `pending_waiting`, `processing_active`, `processing_expired`, `processing_unleased`, `failed`. Pending states split at `available_at <= database_now`; processing states split at `lease_until <= database_now`, with null leases reported separately. These are delivery counts, not unique events. Failed deliveries require explicit operator replay; they are not due jobs.
- `strata_outbox_sample_capped{state}`: 1 when the count is a lower bound; 0 when that state's count is exact at the snapshot. Never sum capped values into an authoritative backlog total.
- `strata_outbox_actionable_lateness_seconds{state}`: oldest due-time lateness for pending_due or lease-expiry lateness for processing_expired; 0 when empty. Indexed ascending selection retains the oldest boundary even when the count is capped. This is not original event age, execution duration, or the time a failed delivery entered terminal failure. Other states omit this measurement.

All values are shared-schema platform gauges: use one designated collector or `max`, not sum across replicas. No tenant, event, listener, SQL, payload or secret labels are exposed. Metrics routes remain bearer-authenticated, and the default is still HTTP-only.

A 1–5,000ms deadline (default 1,000ms) bounds the scrape result. Collection uses a read-only transaction with a transaction-local [Postgres statement timeout](https://www.postgresql.org/docs/16/runtime-config-client.html), restored automatically on transaction completion/rollback. The collector passes its deadline signal through `runInTransaction` native cancellable acquisition. A timed-out Bun pool wait is removed without admitting a later callback; unsupported checkout adapters fail collection explicitly. It still refuses another transaction while cancellation/rollback/release is settling. `close()` stops new collection and waits for release; integrate it before pool closure and within the application's hard shutdown deadline. Admission/SQL/rollback network operations can still outlast the response deadline; this is not a claim that every underlying resource is released at that instant. Native connection/network timeout and infrastructure supervision still matter during a server outage.

Three independent restricted-role processes, SQL table-lock, saturated-pool, cancellation/rollback, scope restoration, read-only source state, recovery, unsupported-dialect and authenticated failure regressions accompany the collector. The remaining #139 items include generated lifecycle wiring and deployment qualification. This addition does not close #139 or address encryption-key rotation (#140).


## Opt-in tracing health

```ts
import { createMetricsRoutes } from "@getstrata/bootstrap/metricsRoutes";
import { getTracingRuntime } from "@getstrata/core/tracing/tracingMiddleware";

// After tracing initialization, use the existing provider-owned runtime.
const metrics = createMetricsRoutes({ tracing: getTracingRuntime() });
```

The route reads `runtime.metrics()` after bearer authorization. It never initializes a runtime, flushes spans, contacts a collector or takes ownership of shutdown. Default routes remain HTTP-only. Observation failures emit `strata_tracing_collector_success 0`, omit tracing observations and preserve other metrics. Success emits 1. An explicit runtime also exposes the same typed snapshot and `renderTracingMetrics(snapshot)` through root and tracing subpath exports.

These measurements are **process-local**, per injected runtime. Scrape each replica/worker separately; apply `rate` to individual counters before summing, and inspect queue utilization per process. They cannot describe an application-owned global SDK or a downstream collector's queue, persistence or ingestion success.

- `strata_tracing_enabled`, `strata_tracing_exporter_configured`, `strata_tracing_active`: explicit configuration and lifecycle gauges. Disabled/no-exporter configurations omit unavailable queue size/capacity rather than claiming empty capacity. Active becomes 0 after shutdown settles, including failure.
- `strata_tracing_queue_size`, `strata_tracing_queue_capacity`: the SDK's current waiting span count and configured capacity. In-flight exports are excluded. Queue size becomes unavailable after the SDK removes its observation on successful shutdown. Compare size/capacity for saturation; do not subtract export counters to invent occupancy.
- `strata_tracing_dropped_spans_total`: SDK-reported processor overflow. Custom exporter errors named `queue_full` are excluded from overflow accounting. This is not a total of all telemetry loss, unsampled spans or collector rejection.
- `strata_tracing_exported_batches_total`, `strata_tracing_failed_batches_total`, and corresponding `exported_spans_total` / `failed_spans_total`: exporter callback SUCCESS/FAILED or synchronous export throw outcomes. Only the first callback is counted/forwarded. Success means exporter acknowledgement, not durable storage by a backend. Error text, error names, endpoints, component IDs and span data are never retained as metrics or labels.
- `strata_tracing_export_deadline_exceeded_batches_total`: export calls whose callback did not arrive within configured `exportTimeoutMillis`. This is an observation, not cancellation or a terminal outcome. A late success increments both this counter and success counters. Unacknowledged batches do not masquerade as completed failures. SDK queue scheduling, transport/retry and timeout behavior remain SDK-owned; resource-attribute resolution time before an export call is not included in this measurement.
- `strata_tracing_flush_failures_total`, `strata_tracing_shutdown_failures_total`: rejected runtime lifecycle operations. Failures still propagate to their caller/coordinator; idempotent shutdown counts rejection once. A rejected flush can have multiple underlying failed exports, so these counters are not additive loss totals.

The adapter uses the pinned OpenTelemetry **2.12.0 public experimental** `BatchSpanProcessor.selfObsMeterProvider` option through `@opentelemetry/sdk-trace`, with a fixed projection of three [SDK self-observation instruments](https://opentelemetry.io/docs/specs/semconv/otel/sdk-metrics/). It does not read private processor fields, replace global meter/diagnostic providers, or implement batching/export transport. No arbitrary instrument/attribute registry, per-span history or error sample collection is allocated. One SDK queue callback and scalar counters are retained per runtime; callback-deadline timers hold scalar accounting only, expire within the configured bound and are unreferenced. Keep the SDK version pinned and rerun queue, outage and lifecycle regressions when upgrading this experimental API. Unknown queue instruments leave measurements unavailable.

Tests exercise real Bun HTTP collector outage and callback deadlines, 10,000 overflow observations, draining, late/duplicate callbacks, synchronous failures, no-op meter isolation, custom error-name collisions, disabled/unconfigured states, authenticated no-flush scraping and lifecycle rejection. Sustained memory/CPU/load qualification and operational thresholds remain #139 promotion work, along with acquisition measurements, additional outbox dialects and generated wiring. Encryption-key rotation (#140) remains separate.


## Opt-in transaction acquisition observations

```ts
import { createTransactionAcquisitionMetrics, runInTransaction } from "@getstrata/core/database/transaction";
import { createMetricsRoutes } from "@getstrata/bootstrap/metricsRoutes";

const acquisitionMetrics = createTransactionAcquisitionMetrics();
const routes = createMetricsRoutes({ transactionAcquisition: acquisitionMetrics });
await runInTransaction(async db => {
  await db.unsafe("SELECT 1");
}, { acquisitionMetrics, acquisitionSignal: AbortSignal.timeout(1000) });
```

Use one factory-created collector for the selected transaction boundaries in a process. Native `reserve()` is required when opting in; adapters without it fail admission explicitly. Existing unobserved transactions retain the direct `begin()` path. The collector adds no cancellation or deadline; use `acquisitionSignal` and native connection timeouts separately. All reservation release, deferred-event, rollback, savepoint and tenant-scope behavior stays framework-owned.

Timing uses a monotonic clock immediately around native checkout. It includes waiting for a slot and establishing a connection, which Bun does not separately expose. It excludes BEGIN, SQL, business work, commit/rollback, release and observer delivery. Nested/savepoint calls acquire no new connection and produce no sample. Pre-aborted or unsupported-adapter admission also produces no checkout sample. A successful reservation counts as acquired even if subsequent admission cancellation, BEGIN, business work or release fails.

- `strata_database_acquisition_collector_success`: snapshot rendering succeeded (1) or failed (0). This is not database readiness or availability. Failure omits acquisition observations and preserves HTTP/other collectors.
- `strata_database_transaction_acquisition_inflight`: selected native checkouts started and not yet settled.
- `strata_database_transaction_acquisition_duration_seconds`: a cumulative histogram with fixed seconds buckets from 0.001 to 10 and +Inf, with count and sum. Its only label is `outcome`: `acquired` for a fulfilled reservation; `aborted` for a rejected reservation when the caller's signal was aborted at settlement; `failed` for other rejection. Aborted does not assert that cancellation caused an otherwise simultaneous connection failure. Errors retain their identity for the caller, but no text, URL or error class enters metrics.

Snapshots contain three fixed outcome records and twelve finite buckets each, cloned on read. No samples, connection identities, tenants, request paths or unbounded label registry are retained. The metrics route reads only local state after bearer authorization; it never checks out a connection, queries a server, or registers cleanup. Idle zero counts mean **no observed checkout attempts**, not healthy zero latency. Metrics are absent unless explicitly configured.

These are process-local observations of **selected `runInTransaction` outer reservations**, not a global Bun pool statistic. Direct SQL, unobserved transactions and tenant scopes that already own their connection are outside this boundary. Actual server connection capacity, connection establishment versus pool wait, all driver operations and deployment-wide availability require other supported instrumentation/infrastructure exporters. Do not infer total pool occupancy or connection capacity from the inflight gauge. Apply `rate` to per-target histogram counters before aggregation; preserve the monitored boundary/database in deployment target labels. No arbitrary per-tenant/pool label API is provided.

Tests cover saturated restricted-role Postgres waits, native cancellation without late admission, unchanged tenant scopes/savepoints, error identity, release and business failure boundaries, simultaneous waits, immutable snapshots, 10,000 observations with constant histogram/scrape cardinality, authenticated no-SQL scraping and invalid observation rejection. The API/type fixtures compile against source and packed root/subpath exports. Operational alert thresholds and sustained multi-process load/recovery qualification remain #139 work, alongside additional outbox dialects and generated wiring. #140 remains separate.


## Opt-in SQL failed-job observations (Postgres)

```ts
import { createFailedJobMetricsCollector } from "@getstrata/core/queue/queueMetrics";
import { createMetricsRoutes } from "@getstrata/bootstrap/metricsRoutes";

const failedJobs = createFailedJobMetricsCollector({ sampleLimit: 500, timeoutMs: 1000 });
const metrics = createMetricsRoutes({ failedJobs });
// Register failedJobs.close() before closing the database, within the shutdown deadline.
```

The collector observes retained records in the framework's **global** `failed_job` table, not pending retries, Redis quarantine, unique logical job IDs, or a cumulative failure counter. It reads only IDs with the official repository projection, ordering by the existing ID primary key and fetching at most `sampleLimit + 1` records. It never calls `listRecent`, loads payloads/exceptions, dispatches a retry, deletes a recovery record, or changes the legacy `collectQueueMetrics()` API. No migration or added index is required for the standard schema.

- `strata_queue_failed_job_collector_success`: 1 on success; 0 on failure/timeout, missing table, unsupported dialect or incompatible schema. Failed observations are omitted, and HTTP/other successful observations remain available.
- `strata_queue_failed_jobs_sample`: capped retained-record count; exact when the cap flag is 0, a lower bound when it is 1.
- `strata_queue_failed_jobs_sample_capped`: whether more than the configured number of records were visible in the snapshot. The configured limit is 1–1,000 (default 500).

These are shared-database gauges. Use one designated collector or `max` across replicas reading the same schema; never sum them into a backlog total. No job/tenant/priority/error labels or IDs appear. Failed records require operator replay/removal; this collector deliberately emits **no age**. The standard schema lacks a time index that supports a bounded oldest-failure query, and oldest ID is not oldest failure time. Do not invent an age from that ordering or label terminal failed records as automatically actionable work.

Initially Postgres-only, using the existing runtime role's SELECT access; there is **no RLS bypass** or administrative credential. A metadata lookup requires a persistent, ordinary global table with a valid single integer-ID primary key and no enabled RLS. RLS-enabled, partitioned, temporary/unlogged, view-backed or differently keyed schemas fail explicitly, rather than producing a misleading hidden zero or falling back to a table sort. A transaction-local ACCESS SHARE lock prevents concurrent DDL/schema/RLS changes between validation and projection. The lock and catalog validation are Postgres mechanisms; the ordinary data read uses the ORM.

The collector and outbox observations share one internal read-only lifecycle: a 1–5,000ms response deadline (default 1,000ms), native cancellable checkout, transaction-local statement timeout, rejection of any active framework or raw connection scope, one unsettled transaction per collector and `close()` draining release/rollback. Outbox's existing narrowly scoped platform bypass remains confined to its callback; the shared helper contains none. Authorized concurrent scrapes of a route instance coalesce. Collection does not write data; local settings/locks restore on settlement. Underlying SQL/rollback/network cleanup can outlast the response deadline, so lifecycle hard deadlines and infrastructure supervision still matter. The row limit bounds returned IDs, not all physical index/MVCC work in a bloated or poorly maintained database; keep vacuum/statistics healthy and qualify costs against the production distribution.

Regressions cover 20,000 private records with an actual restricted-role primary-index `EXPLAIN ANALYZE`, empty/capped/recovered state, unchanged private source data, RLS/key/persistence/missing-table rejection, twenty authenticated concurrent blocked scrapes, native pool cancellation, rollback/release draining, three independent processes, malformed observations and unchanged outbox lease/worker/crash behavior. Both new source files are coverage-enforced at 100%, with no added exemptions. Additional SQL dialects, generated runtime wiring and sustained load/operational qualification remain #139 work; encryption rotation (#140) remains separate.
