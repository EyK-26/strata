# Redis queue recovery and Streams rollout

Strata's application queue is selected by `QUEUE_DRIVER=sync|async|redis`. For Redis, `QUEUE_REDIS_TRANSPORT=lists|streams` selects the transport; unset means `lists` for upgrade compatibility. Invalid transport values fail Redis startup/admission. Use the published `createAppQueue` and `createQueueWorker` factories (generated providers and CLI commands already do). Direct `RedisQueue`/`QueueWorker` construction remains the legacy list implementation; `RedisStreamsQueue`/`RedisStreamsWorker` is explicit Streams construction.

The worker factory can now return either implementation. Type injected workers with `ReturnType<typeof createQueueWorker>` (as the generated CLI does), rather than annotating the concrete legacy `QueueWorker` class. Existing one-argument `Job.handle(payload)` implementations remain supported.

## Streams delivery contract

Streams requires Redis 6.2 or newer for [`XAUTOCLAIM`](https://redis.io/docs/latest/commands/xautoclaim/). Each existing priority namespace gets a `:stream` key and the framework's `strata-workers-v1` group. Producers use `XADD`; workers use nonblocking `XREADGROUP`, checking high/default/low in that order. High priority can starve lower priority; bound high-priority traffic accordingly. Group creation starts at `0`, preserving entries produced before workers start.

A bounded `XAUTOCLAIM COUNT 1` scan retains its cursor across polls and recovers idle pending work. `QUEUE_VISIBILITY_MS` defaults to 60000 and must be an integer of at least 30; choose a value comfortably above Redis round-trip latency and expected event-loop stalls. A worker renews at approximately one third of that interval. An atomic owner-and-idle check fences renewal and acknowledgement, so an expired or replaced consumer cannot acknowledge work owned by its successor. Empty consumers are removed after polling, completion, and reclaim to avoid accumulating metadata after worker restarts.

Successful handling (or a successfully persisted terminal `failed_job` record) permits `XACK` and `XDEL` in the same Lua operation. A failed SQL recovery-record write leaves the entry pending. Malformed envelopes and unknown job names are moved to a `:stream:invalid` stream before acknowledgement; a bad quarantine destination retains the source. Monitor and review this retained data. Restore job registration and replay deliberately; do not discard malformed messages automatically or trim live stream entries. Acknowledged entries are deleted, so these Streams are work queues, not event-history feeds. Additional consumer groups are unsupported.

Delivery is **at least once**. A process can complete an external effect and die before acknowledgement; handlers must make business effects idempotent. An optional second handler argument exposes the transport identity and cooperative ownership-loss signal:

```ts
import { Job, type JobContext } from "@getstrata/core/queue";

class Deliver extends Job<{ businessId: string }> {
  async handle(payload: { businessId: string }, context?: JobContext) {
    context?.signal.throwIfAborted();
    // Use payload.businessId for durable business deduplication.
    // Pass context?.signal to supported cancellable I/O.
  }
}
```

`context.jobId` combines the stream namespace and a generated identity and survives reclamation and persisted automatic retries, even when promotion creates a new stream entry. Envelopes admitted by older producers use their original stream entry ID as the identity on their first retry. `queue:retry` preserves a stored logical identity through the configured queue's replay capability. Old recovery rows without an identity use fresh admission. Local/synchronous queues and legacy list workers do not provide this context. Ownership loss or forced close aborts the signal; JavaScript cannot forcibly undo effects or stop a handler that ignores cancellation. Graceful stop instead drains the admitted handler and does not reserve its successor.

Redis persistence, replication/failover, memory, and eviction settings determine storage durability; configure queue Redis without eviction and alert on pending age, failed jobs, quarantine growth, and replication failures. Queue depth for Streams counts queued, **in-flight**, and scheduled retry entries; per-priority snapshots are atomic during transitions. Use a dedicated non-sharded Redis deployment; Redis Cluster is not qualified by this implementation's cross-key scripts. Streams retries persist the next attempt and its due time in a per-priority sorted set (`:stream:retries`), fenced against expired or replaced ownership, before acknowledging the current entry. Backoff remains linear (`backoffMs * nextAttempt`), but workers release ownership during that wait. Redis [server time](https://redis.io/docs/latest/commands/time/) sets the due time, so worker clock differences do not trigger early execution. Workers atomically promote at most 100 due retries per priority per poll, copying each envelope before removing its schedule. Promotion needs a running worker; downtime delays execution rather than resetting attempts. Job retry settings are read from the currently deployed handler on each attempt. Retry delays must be nonnegative safe-integer milliseconds, with room for the epoch timestamp; invalid values fail without acknowledging the source. Local queues and legacy list workers retain their existing in-process retry behavior.

Stop and drain older Streams workers before deploying this retry format: older workers ignore its logical identity and retry scheduling contract. New workers accept old producer envelopes, including maintenance-converted messages. Do not revert workers while scheduled retries remain; older releases cannot promote them. Queue storage has no automatic expiry because it contains unfinished work; sorted-set entries are removed on promotion, leaving no separate payload metadata.

A crash during handler execution still replays the admitted attempt. Terminal SQL failure recording and Redis acknowledgement remain separate: if SQL persistence fails, the pending entry is retained; a crash after SQL recording can create a duplicate recovery record. Delivery remains at least once. Manual SQL replay preserves identity when one was captured, as described below.

## Total job deadlines

The Streams queue has an explicit typed admission API that returns the stable logical ID:

```ts
import { RedisStreamsQueue } from "@getstrata/core/queue/redisQueue";
const redisUrl = process.env.REDIS_URL;
if (!redisUrl) throw new Error("REDIS_URL is required");
const queue = new RedisStreamsQueue(redisUrl);
try {
  const jobId = await queue.enqueue(deliverJob, payload, { timeoutMs: 120_000 });
  // Store jobId with application-owned tracking if needed.
} finally {
  queue.close();
}
```

`timeoutMs` is an integer from 1 through 2,147,483,647 milliseconds (about 24.8 days). Omit it for no deadline. Existing `dispatch(job, payload): Promise<void>` remains supported. This capability belongs to the explicitly selected Streams transport; local and legacy list queues do not provide `enqueue` or durable deadlines.

Admission reads Redis server time and persists one absolute `deadlineAtMs` in the envelope. The lifetime starts at that clock read, includes admission latency, queue waiting, every handler attempt, and retry backoff, and never resets after recovery. Retry schedules are capped at the deadline so a long backoff cannot postpone expiry processing. The optional `JobContext.deadlineAtMs` exposes the same timestamp to handlers.

Before calling a handler, workers check Redis time: expired work is recorded as `Streams job deadline exceeded` in SQL failed-job storage and then acknowledged with ownership fencing. If SQL recording fails, the pending entry remains recoverable. Live deadlines abort the handler signal using bounded timers that recheck Redis time; clock-read failures abort processing without acknowledging the entry. The worker also checks the deadline after the handler exits, including if an event-loop stall delayed the timer. Expiry is processed by workers, so an outage can delay failure recording.

Handlers must pass the signal to cancellable I/O and support replay. A deadline cannot undo an external side effect, interrupt blocking JavaScript, or terminate a handler that ignores its signal. Workers keep renewing ownership and wait for the handler to finish before recording deadline failure; they do not detach still-running work. Retrying a failed deadline job manually is a deliberate new execution with the same recorded identity and no inherited deadline.

Drain older Streams workers before admitting deadline-bearing jobs. Older releases ignore this field, so a mixed worker rollout cannot enforce the contract. Caller-requested cancellation is described below.

## Durable cancellation requests

Opt in when admitting through the explicitly selected `RedisStreamsQueue`:

```ts
const jobId = await queue.enqueue(deliverJob, payload, {
  cancellable: true,
  timeoutMs: 120_000, // Optional; cancellation does not require a deadline.
});
// After application authorization verifies ownership of this tracked job:
const accepted = await queue.cancel(jobId);
```

`cancel` accepts a returned UUID identity in this queue's current namespace. It returns `true` when Redis retains the request, including repeated requests; `false` means there is no control record (completed, not opted in, unknown, or admitted by an older release). A namespace/identity mismatch throws. The framework supplies transport control, not tenant/shopper authorization: applications must authorize cancellation before calling it. An accepted request does not certify that external effects stopped or were undone. If the reply is lost, repeat the call with the same ID.

Each opted-in unfinished job has one Redis hash (`:stream:control:<uuid>`) recording active/cancelled state and, after retry admission, its latest retry envelope. There is no time-based expiry that could forget cancellation during a long wait. Requests wake a currently scheduled retry by setting its due score to zero; already-promoted retries are not copied again. Queued or reclaimed cancelled work is recorded as `Streams job cancelled` in SQL failed-job storage before acknowledgement. Failed SQL recording retains both the pending work and the request for recovery.

Running workers check cancellation during lease renewal and before terminal processing. Once observed, the handler signal aborts; the worker keeps renewing and waits for the handler to exit. Cancellation also fences deferred retry admission. Observation latency depends on visibility/renewal cadence and Redis availability, so this is cooperative cancellation rather than an immediate interrupt. A handler that completes before observing the request may already have performed its effect. Shutdown/ownership-loss aborts remain distinct from durable cancellation.

Ownership-fenced terminal acknowledgement deletes the control hash together with the stream entry. Metadata is proportional to opted-in unfinished jobs, including quarantined work that needs operator resolution. Do not expire/delete control records of pending or scheduled jobs. Monitor unfinished/quarantined work and control-state errors. Wrong Redis types, missing control state, or incomplete admission writes fail closed; workers retain work for operator repair instead of ignoring cancellation. Redis persistence/failover settings still determine durability. Manual failed-job replay starts new execution controls without inherited opt-in state; a recorded identity is preserved.

Drain older Streams workers before admitting cancellable jobs: older versions ignore control state and cannot clean it up. Non-opted-in `enqueue` and ordinary `dispatch` keep their existing behavior and allocate no control hashes. Local and legacy list transports do not provide this capability.

## Failed-job identity migration and replay

**Before upgrading runtime/CLI packages, add nullable `failed_job.job_id` to every existing application's SQL schema, even if its queue is local or list-based.** New generated schemas include this column; existing applications need a new file migration using the published Schema API:

```ts
import { Schema, resolveDatabaseDriver } from "@getstrata/core/database/schema";
import type { Migration } from "@getstrata/core/database/migrations/types";
const migration: Migration = {
  name: "add_failed_job_identity", // Use your application's next migration filename/name.
  async up(db) {
    await Schema.run(db, resolveDatabaseDriver(), schema => {
      schema.table("failed_job", table => { table.text("job_id").nullable(); });
    });
  },
  async down(db) {
    await Schema.run(db, resolveDatabaseDriver(), schema => {
      schema.table("failed_job", table => { table.dropColumn("job_id"); });
    });
  },
};
export default migration;
```

Apply the additive migration before starting new writers. Existing rows and old writers retain `NULL`; do not invent a historical identity from a business payload. The upgrade is covered against populated SQLite, MySQL, and Postgres tables. Downgrading binaries may leave the nullable column in place; dropping it discards recorded identities and requires stopping every new reader/writer first. No framework startup silently alters schema.

Streams failures, including cancellation and expiry, store their logical ID with SQL recovery. `queue:retry` uses the optional typed `Queue.replay(job, payload, jobId)` capability. Streams replay preserves that ID, resets attempts to zero, and clears deadlines/cancellation opt-in. It accepts IDs from the same application queue namespace, including IDs captured from legacy-converted stream entries; priority changes within that namespace are supported. A namespace mismatch or configured transport without replay support rejects admission and retains the SQL row. Recovery rows with `NULL` IDs keep the existing ordinary dispatch path, which allocates a fresh Streams ID if applicable.

Direct callers of `FailedJobService.retry(id, callback)` receive `record.job_id` and must pass it through a supporting queue's `replay` method when present. Admission must succeed before the SQL recovery row is deleted. Redis admission and SQL deletion remain separate: lost replies, deletion failures, and concurrent operators can admit duplicate copies with the same logical ID. This ID is a deduplication key for handlers, not an exactly-once guarantee or an admission lock. Authorize manual replay of cancelled jobs explicitly and make business effects replay-safe.

## Maintenance conversion from lists

Do not mix list and Streams producers or workers. Upgrade binaries first with `QUEUE_REDIS_TRANSPORT=lists`. Before activation:

1. Stop admission on **all** application replicas, schedulers, and producers. Stop/drain every old worker using the framework lifecycle. Back up Redis and the SQL `failed_job` table; keep secrets out of those backups' logs.
2. If an old worker died, wait for its visibility interval and use the published `reclaimExpiredQueueReservations(client)` to return abandoned processing records to ready lists. Live processing records or lease metadata block conversion; do not delete them manually to force the conversion through.
3. Run bounded conversion batches through the published API. The `maintenance: true` argument is an operator assertion that all producers/workers are stopped; it cannot enforce distributed maintenance by itself.

```ts
import { RedisClient } from "bun";
import {
  migrateLegacyQueueToStreams,
  reclaimExpiredQueueReservations,
} from "@getstrata/core/queue/redisQueue";

const redisUrl = process.env.REDIS_URL;
if (!redisUrl) throw new Error("REDIS_URL is required");
const client = new RedisClient(redisUrl);
try {
  await reclaimExpiredQueueReservations(client);
  while (await migrateLegacyQueueToStreams(client, { maintenance: true, batchSize: 100 })) {
    // Each call moves at most 100 entries per priority.
  }
} finally {
  client.close();
}
```

Conversion validates Redis types and copies each FIFO entry into its priority Stream before removing it from the source. Each per-priority batch is atomic; separate priorities can progress independently. If a connection drops after execution, rerun conversion: already removed source entries are not copied again. Recheck all ready, processing, and lease keys are empty. Existing invalid-list records remain available for manual inspection; conversion does not discard them. SQL failed-job records remain in the same table and `queue:retry` uses the newly configured queue after activation.

4. Set `QUEUE_DRIVER=redis` and `QUEUE_REDIS_TRANSPORT=streams` consistently on all replicas and workers, then restart. Streams admission/startup rejects nonempty legacy ready/processing/lease state. This check is a rollout guard, not protection against an old producer being restarted afterwards.
5. Validate all three priorities, SQL failure recording, and worker recovery in the target environment before restoring admission. Do not switch back to `lists` while Streams contains unacknowledged entries; drain/reconcile Streams first. No automatic backwards conversion is provided.

No shop-only worker, signer, delivery insert, or queue format is required. Handlers retain the published `Job` contract; commerce event selection and idempotent effects stay in the application.


## Operational observations

See [runtime metrics](RUNTIME-METRICS.md) for opt-in bounded Redis queue snapshots and authenticated scrape wiring. Shared gauges, capped inflight samples, omitted unavailable values and stream-residence age have explicit semantics; they are not end-to-end delivery guarantees.
