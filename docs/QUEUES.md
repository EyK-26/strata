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

`context.jobId` combines the stream namespace and entry ID and survives automatic reclamation and in-process attempts of that entry. Manual `queue:retry` admission creates a new transport identity; the existing SQL failed-job format is unchanged. Local/synchronous queues and legacy list workers do not provide this context. Ownership loss or forced close aborts the signal and local retry waits; JavaScript cannot forcibly undo effects or stop a handler that ignores cancellation. Graceful stop instead drains the admitted handler and does not reserve its successor.

Redis persistence, replication/failover, memory, and eviction settings determine storage durability; configure queue Redis without eviction and alert on pending age, failed jobs, quarantine growth, and replication failures. Queue depth for Streams counts queued **and in-flight** entries until deletion. Use a dedicated non-sharded Redis deployment; Redis Cluster is not qualified by this implementation's cross-key scripts. This transport release still uses the existing in-process retry backoff: retry counters and due times are not yet persisted, and there are no stored job deadlines. A crash during backoff replays the entry; it does not continue a saved retry schedule. Those are separate F02 follow-ups.

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
