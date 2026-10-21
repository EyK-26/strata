/** Public installed APIs and native Bun Redis; no client or timer substitute. */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import type { InitializedAppContext } from "@getstrata/bootstrap/context";
import { createCacheStore } from "@getstrata/core/cache/createCacheStore";
import { CacheRepository } from "@getstrata/core/cache/repository";
import { Job } from "@getstrata/core/queue";
import { createFailedJobService } from "@getstrata/core/queue/createAppQueue";
import { jobRegistry } from "@getstrata/core/queue/jobRegistry";
import {
  QUEUE_LIST_KEY,
  QueueWorker,
  queueKeyForPriority,
  queueProcessingKey,
  RedisQueue,
  RedisStreamsQueue,
  RedisStreamsWorker,
  reserveQueueJob,
  streamQueueKey,
  updateQueueReservation,
} from "@getstrata/core/queue/redisQueue";
import { appKeyPrefix } from "@getstrata/core/runtime/appKeyPrefix";
import { RedisSchedulerLeaseStore } from "@getstrata/core/scheduler/schedule";
import { RedisClient } from "bun";

const url = process.env.REDIS_URL;
const scope = process.env.APP_KEY_PREFIX;
assert.ok(url, "Use the explicit dedicated Redis fixture URL.");
assert.ok(scope && /^strata-protocol-[0-9a-f-]{36}$/.test(scope), "Use a fresh owned namespace.");
const application: {
  createApp(options: { migrate: false }): Promise<{ context: InitializedAppContext }>;
} = await import(new URL("../bootstrap/createApp.ts", import.meta.url).href);
const database: { closeDatabase(): Promise<void> } = await import(
  new URL("../bootstrap/database.ts", import.meta.url).href
);
const observer = new RedisClient(url);
const taskId = "public-protocol";
// Ownership receipt for cleanup only; every lease operation uses the public store.
const taskHash = createHash("sha256")
  .update(JSON.stringify([scope, taskId]))
  .digest("hex");
const ownedPatterns = [`${scope}:*`, `scheduler:{${taskHash}}:*`];
const marker = `qualification-unrelated-${crypto.randomUUID()}`;
let scopeOwned = false;
let markerOwned = false;
let app: { context: InitializedAppContext } | undefined;
let list: RedisQueue | undefined;
let streams: RedisStreamsQueue | undefined;
let listWorker: QueueWorker | undefined;
let streamWorker: RedisStreamsWorker | undefined;
let cacheA: CacheRepository | undefined;
let cacheB: CacheRepository | undefined;
let leases: RedisSchedulerLeaseStore | undefined;
async function ownedKeys(): Promise<string[]> {
  const keys = (await Promise.all(ownedPatterns.map((pattern) => observer.keys(pattern)))).flat();
  return [...new Set(keys)].sort();
}
let failure: unknown;
let failed = false;
const cleanupErrors: unknown[] = [];
try {
  assert.deepEqual(
    await ownedKeys(),
    [],
    "Capture an empty namespace before admitting owned work.",
  );
  scopeOwned = true;
  assert.equal(await observer.get(marker), null);
  console.log(
    `OWNED_REDIS_RECEIPT ${JSON.stringify({ scope, patterns: ownedPatterns, marker, emptyNamespace: true })}`,
  );
  markerOwned = true;
  await observer.set(marker, "preserve");
  app = await application.createApp({ migrate: false });
  assert.equal(appKeyPrefix(), scope);
  const effects: string[] = [];
  class ProtocolJob extends Job<{ kind: string }> {
    override async handle(payload: { kind: string }): Promise<void> {
      effects.push(payload.kind);
    }
  }
  const job = new ProtocolJob();
  const jobName = `qualification.protocol.${crypto.randomUUID()}`;
  jobRegistry.register(jobName, () => job);
  jobRegistry.track(jobName, job);
  const failedJobs = createFailedJobService();
  list = new RedisQueue(url);
  listWorker = new QueueWorker(url, failedJobs);
  const queueKey = queueKeyForPriority(job.priority);
  assert.equal(queueKey, QUEUE_LIST_KEY);
  assert.ok(queueKey.startsWith(`${scope}:`));
  await list.dispatch(job, { kind: "list" });
  assert.equal(await listWorker.processNext(), true);
  assert.deepEqual(effects, ["list"]);
  await list.dispatch(job, { kind: "reservation" });
  const reservation = await reserveQueueJob(observer, queueKey, "owned-consumer");
  assert.ok(reservation);
  assert.equal(
    await updateQueueReservation(observer, queueKey, { ...reservation, owner: "stale" }, "ack"),
    false,
  );
  assert.equal(await updateQueueReservation(observer, queueKey, reservation, "renew"), true);
  assert.equal(await updateQueueReservation(observer, queueKey, reservation, "ack"), true);
  assert.equal(await updateQueueReservation(observer, queueKey, reservation, "ack"), false);
  assert.equal(await observer.llen(queueProcessingKey(queueKey)), 0);

  streams = new RedisStreamsQueue(url);
  streamWorker = new RedisStreamsWorker(url, failedJobs);
  const jobId = await streams.enqueue(
    job,
    { kind: "streams" },
    { cancellable: true, timeoutMs: 60_000 },
  );
  assert.ok(jobId.startsWith(`${streamQueueKey(queueKey)}/`));
  assert.equal(await streamWorker.processNext(), true);
  assert.deepEqual(effects, ["list", "streams"]);
  assert.equal(Number(await observer.send("XLEN", [streamQueueKey(queueKey)])), 0);
  assert.equal(await streams.cancel(jobId), false);

  cacheA = new CacheRepository(
    createCacheStore({ driver: "redis", redisUrl: url, ttlMs: 60_000, maxEntries: 10 }),
  );
  cacheB = new CacheRepository(
    createCacheStore({ driver: "redis", redisUrl: url, ttlMs: 60_000, maxEntries: 10 }),
  );
  let fills = 0;
  assert.deepEqual(
    await cacheA.tags("group").remember("filled", async () => ({ value: ++fills })),
    { value: 1 },
  );
  assert.deepEqual(
    await cacheB.tags("group").remember("filled", async () => ({ value: ++fills })),
    { value: 1 },
  );
  assert.equal(fills, 1);
  assert.equal(await cacheB.tags("group").flush(), 1);
  assert.equal(await cacheA.get("filled"), undefined);
  await cacheA.getOrSet("owned?item=one", async () => 1);
  await cacheA.getOrSet("owned?item=two", async () => 2);
  assert.equal(await cacheB.invalidateByPrefix("owned"), 2);
  assert.equal(await cacheA.size(), 0);

  leases = new RedisSchedulerLeaseStore({ redisUrl: url, namespace: scope });
  const owner = { taskId, occurrenceId: "one", token: crypto.randomUUID() };
  const stale = { ...owner, token: crypto.randomUUID() };
  assert.equal(await leases.acquire(owner, 60_000), true);
  assert.equal(await leases.acquire(stale, 60_000), false);
  assert.equal(await leases.renew(stale, 60_000), false);
  assert.equal(await leases.complete(stale, 60_000), false);
  await leases.release(stale);
  assert.equal(await leases.renew(owner, 60_000), true);
  assert.equal(await leases.complete(owner, 60_000), true);
  assert.equal(await leases.acquire(owner, 60_000), false);
} catch (error) {
  failed = true;
  failure = error;
} finally {
  const cleanups: Array<() => unknown | Promise<unknown>> = [
    () => listWorker?.close(),
    () => streamWorker?.close(),
    () => list?.close(),
    () => streams?.close(),
    () => cacheA?.close(),
    () => cacheB?.close(),
    () => leases?.close(),
    () => app?.context.dispose(),
    () => database.closeDatabase(),
    async () => {
      if (!scopeOwned) return;
      const keys = await ownedKeys();
      if (keys.length) await observer.del(...keys);
      assert.deepEqual(await ownedKeys(), [], "All owned Redis protocol keys must be removed.");
    },
    async () => {
      if (markerOwned) assert.equal(await observer.get(marker), "preserve");
    },
    async () => {
      if (markerOwned) await observer.del(marker);
    },
    () => observer.close(),
  ];
  for (const cleanup of cleanups) {
    try {
      await cleanup();
    } catch (error) {
      cleanupErrors.push(error);
    }
  }
}
if (failed || cleanupErrors.length)
  throw new AggregateError(
    [...(failed ? [failure] : []), ...cleanupErrors],
    "Installed Redis protocol contract or owned cleanup failed.",
  );
console.log(
  "PASS installed native Redis list/Streams delivery and ACK, cache coordination and scheduler fencing; owned keys restored and unrelated marker preserved",
);
