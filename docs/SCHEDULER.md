# Scheduled occurrences and ownership

`Schedule.command(expression, name, handler)` uses Bun's cron parser to determine which tasks are due in a minute window. Names are trimmed, nonempty, unique within a schedule and at most 200 characters; a schedule supports at most 4,096 tasks. Keep names stable across deployments. Changing the expression does not change a task's ownership identity; changing its name or coordination namespace does. All replicas must share schedule definitions, namespace, cron timezone and synchronized clocks.

`runDueScheduledTasks(schedule, now, options)` returns the number of tasks it successfully ran and completed. A task claimed/completed by another runner, or blocked by overlap, is skipped. A handler exception or coordination failure rejects the run; it does not silently fall back to local execution. Zero-argument callbacks remain valid. The public `ScheduledTask.run` contract now takes a context: code invoking callbacks directly must supply one; normal applications should use the runner, which establishes ownership.

## Redis coordination

Production defaults to `SCHEDULER_COORDINATION=redis`, requiring `REDIS_URL` when there is due work. You can configure `coordination`, `redisUrl` and `namespace` through runner options. Namespaces are trimmed, nonempty and at most 512 characters. The default namespace derives from `APP_KEY_PREFIX`. A run owns and closes its Redis connection after all admitted tasks settle. Injected `leaseStore` implementations retain caller ownership; they must implement the same atomic acquire/renew/complete/release contract and their own bounded command deadlines.

Each task has an active overlap lease, a minute occurrence lease, and a completion record for that occurrence. Lua atomically claims both leases only if neither is owned and the occurrence is not completed. Random ownership tokens guard renewal, completion and release. All keys for a task share a Redis Cluster hash slot. Keys have TTLs; no KEYS/SCAN operations or permanent completion history are used. Wrong key types fail before script mutation.

Defaults are 30-second leases, renewal every 10 seconds, command timeout one second, and completed retention seven days from completion. `leaseMs` supports 100–3,600,000 ms; `renewalMs` and `commandTimeoutMs` must be positive integers no greater than one third of the lease. Completion retention must be at least the lease and at most 2,147,483,647 ms. These controls are available in `SchedulerRunOptions`. Choose budgets with enough headroom for event-loop pauses and infrastructure latency. Completion deduplication ends when its TTL expires. Use durable application idempotency for longer-lived effects.

Run multiple schedulers against the same Redis coordination store and namespace. A task holding its overlap lease excludes later minute occurrences until it completes, fails or loses ownership. Skipped overlapping minutes are not queued. The scheduler is a due-task coordinator, not a durable workflow queue: it does not automatically backfill missed minutes or recover old occurrences after restart. An operator/recovery process can deliberately invoke the runner with the original `now` to retry an uncompleted occurrence. Death or lease expiry allows that occurrence to be claimed again. The ordinary next tick evaluates the new current minute.

## Handler contract and replay

```ts
schedule.command("* * * * *", "inventory-scan", async (context) => {
  // Stable opaque ID: namespace + task name + scheduled minute.
  const key = context.occurrenceId;
  await context.assertOwnership();
  await applicationScan({ idempotencyKey: key, signal: context.signal });
});
```

Context includes `taskName`, `occurrenceId`, the minute-normalized `scheduledAt`, an `AbortSignal` and `assertOwnership()`. IDs differ across tasks/namespaces and stay the same when replaying an occurrence. `assertOwnership` performs an ownership-checked renewal and rejects on loss or uncertainty. Failed renewal aborts the signal; handlers must stop cooperatively and await all their work. Completion is rejected after ownership loss. Redis command deadlines do not prove whether an unacknowledged mutation happened; lease expiry/completion lookup and replay remain authoritative.

Normal lifecycle stop ends admission; it does not cancel an already admitted handler's signal. Renewal continues while that work drains. Only lease loss/uncertainty aborts that signal. The lifecycle hard deadline remains the final process bound; process death leaves expiring leases, not completed records.

A lease is not a database fencing token and cannot stop a paused process or uncooperative handler from making external writes. Redis failover, eviction or lost completion persistence can also permit replay. Use a coordination Redis with appropriate durability, capacity and eviction policy, and verify failover for your deployment. Protect effects with application database constraints, transactions and provider idempotency keys. Delivery can repeat; this does not provide exactly-once effects or a guaranteed catch-up schedule.

## Explicit single-runner mode

`coordination: "single-runner"` or `SCHEDULER_COORDINATION=single-runner` selects one-process operation; development defaults to it. Each Schedule instance retains an active lease and completed minute high-water mark per registered task, bounded by the task limit. It suppresses same/older minutes and overlap in that instance, but state is lost on restart. Separate Schedule instances/processes do not coordinate. Configure this explicitly in production only when the deployment truly has one scheduler process. It is never a Redis outage fallback.

Published root and scheduler subpath exports share `appSchedule` and class identity. CLI `schedule:run` and the in-process cron runner use the same coordination policy and preserve phased drain/flush/close behavior. Configure coordination before launching them; workers and HTTP replicas do not select independent scheduler namespaces.

Tests include three actual Bun runners against Redis, owner SIGKILL/replay, repeated ticks, slow renewal across minute boundaries, stale-owner checks, application namespace isolation, handler failure/retry, lease-loss cancellation and admission shutdown during an outstanding claim.

References: [Redis distributed lease ownership](https://redis.io/docs/latest/develop/clients/patterns/distributed-locks/), [Bun cron](https://bun.com/docs/runtime/cron).
