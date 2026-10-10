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

Each priority is read atomically through one Lua invocation; the three priorities are not a single cross-priority instant. Reads use cardinalities, rank-based retry counts, at most 501 pending entries, and one oldest stream entry. They do not use KEYS, scan jobs, parse retry payloads or enumerate consumers. Redis documents [bounded XRANGE reads](https://redis.io/docs/latest/commands/xrange/), [ZCOUNT cost](https://redis.io/docs/latest/commands/zcount/) and [XPENDING's consumer-enumerating summary cost](https://redis.io/docs/latest/commands/xpending/); this collector uses the bounded range form of XPENDING instead. These commands still consume Redis capacity: measure scrape frequency/cost with the target deployment. Redis Cluster hash-slot compatibility is unchanged from the existing queue protocol; no new Cluster support is claimed.

## Metric semantics

- `strata_queue_collector_success`: 1 on successful collection, 0 on dependency/configuration/timeout failure. On failure all queue observations are omitted, rather than reported as empty or stale. HTTP metrics remain available with status 200; alert on this gauge as well as Prometheus `up`. With the collector disabled this gauge is absent.
- `strata_queue_unfinished_jobs{priority}`: exact retained stream/list entries plus scheduled retries, excluding quarantine and SQL failed-job records. For Streams, acknowledged entries are removed by the queue protocol; externally deleting or acknowledging entries outside that protocol invalidates interpretation.
- `strata_queue_jobs{priority,state}`: `ready`, `inflight_sample`, `retry_due`, `retry_waiting`, `quarantined`. Retry states are available only for Streams. Due/waiting is measured with Redis server time. Quarantine is protocol-invalid/dead-letter Redis state, not all handler failures recorded in SQL.
- `strata_queue_inflight_sample_capped{priority}`: Streams inflight reads return at most 500 entries. A value of 1 means `inflight_sample` is a lower bound and `ready` is unavailable/omitted. Lists use exact list cardinality and this flag is 0. Even when capped, unfinished/retry/quarantine counts remain exact. State values must not be summed into an exact total when capped.
- `strata_queue_oldest_stream_entry_age_seconds{priority}`: Redis-server residence age of the oldest current stream ID; 0 when empty. It includes retained inflight entries. Retry promotion creates a new stream ID, so this is **not** original job lifetime or time since the initial dispatch. No age sample is exposed for lists. Scheduled retry wait time is not included in this residence age.

Priorities are fixed `high`, `default`, `low`. These are shared application-namespace gauges: if multiple processes scrape the same Redis namespace, use `max` or one designated target, **not sum across replicas**. HTTP request counters remain per process and can be summed across replicas. Snapshot reads are observational and require only access to the relevant queue protocol keys/commands, not database privileges or a tenant bypass.

The older `collectQueueMetrics()` API remains compatible. Its `failedCount` is a sample capped at 1,000 SQL failures and its pending depth semantics differ; do not treat it as an exact failed total. This new scrape deliberately does not expose that value as an authoritative gauge.

## Remaining work and promotion gates

This is the Redis observation slice of [#139](https://github.com/EyK-26/strata/issues/139), not complete operational qualification. SQL failed-job observations, additional outbox dialects, actionable queue retry age, connection acquisition measurements where observable, OpenTelemetry exporter failure/saturation observations and generated wiring remain follow-up work. A Bun pool statistic or SDK queue occupancy must not be invented when its supported API cannot observe it. Use infrastructure exporters for persistence, server connection capacity and backup health.

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

A 1–5,000ms deadline (default 1,000ms) bounds the scrape result. Collection uses a read-only transaction with a transaction-local [Postgres statement timeout](https://www.postgresql.org/docs/16/runtime-config-client.html), restored automatically on transaction completion/rollback. The framework transaction contract does not yet expose cancellation of pending pool checkout. If that wait exceeds the deadline, its late callback performs no collection, and a collector refuses another transaction while the first is still settling. `close()` stops new collection and waits for release; integrate it before pool closure and within the application's hard shutdown deadline. This is deliberately not a claim that every underlying resource is released at the scrape deadline. Native connection/network timeout and infrastructure supervision still matter during a server outage.

Three independent restricted-role processes, SQL table-lock, saturated-pool, cancellation/rollback, scope restoration, read-only source state, recovery, unsupported-dialect and authenticated failure regressions accompany the collector. The remaining #139 items include SQL failed-job observations, queue retry lateness, supported acquisition/tracing signals, generated lifecycle wiring and deployment qualification. This addition does not close #139 or address encryption-key rotation (#140).
