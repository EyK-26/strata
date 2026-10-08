# Shared Redis cache

The Redis driver coordinates cache fills and invalidation across application and worker processes. Commerce rules and database consistency remain in the application. Cache loaders must be read-only or tolerate replay: recovery can execute a loader again, and cache ownership does not fence external side effects.

## Public API

Use `createCacheStore` and `CacheRepository`, including `cache.tags(...names).remember(key, loader)`. Tagged remember binds tags **before** loading. Calling `attachTags` after an untagged fill cannot retroactively protect that fill from an earlier tag invalidation. Use consistent tags for a logical key.

```ts
import { createCacheStore } from "@getstrata/core/cache/createCacheStore";
import { CacheRepository } from "@getstrata/core/cache/repository";

const cache = new CacheRepository(createCacheStore({
  driver: "redis",
  redisUrl: process.env.REDIS_URL,
  ttlMs: 60_000,
  maxEntries: 1000,
  redis: { fillTimeoutMs: 30_000, metadataTtlMs: 60_000 },
}));

await cache.tags("catalog").remember("catalog?category=12", async (signal) => {
  // Redis loaders receive an AbortSignal. Pass it to cancellable operations.
  return fetch(catalogUrl, { signal }).then(response => response.json());
});
```

Existing no-argument loaders remain compatible. The array driver retains its existing process-local semantics and may omit the signal. Prefix invalidation continues to match the exact key and `prefix?…`; it is not arbitrary textual prefix matching. Tag flush returns the number of published entries removed, excluding pending fills.

## Consistency and bounds

One static Lua script atomically coordinates five explicitly supplied Redis keys in one hash slot. Entries, expiry and shared LRU order have at most `maxEntries` members; tags are embedded in entries instead of separate reverse-index sets. No application operation uses Redis `KEYS` or `SCAN`. Lua scans are limited to the configured entry and metadata cardinalities, but still block Redis during execution. Choose limits and measure operation latency with representative data; this is not a throughput qualification or Redis Cluster qualification.

A miss acquires a unique, renewable lease with a finite deadline. Tag and query-prefix generations are captured at acquisition. Exact invalidation, prefix invalidation, tag invalidation, clear and direct writes prevent older owners from publishing. Every renewal, release and publication checks ownership. A killed owner is recovered after lease expiry. An old caller may receive its loaded value after invalidation, but that value cannot repopulate shared storage. A waiter requesting an additional tag starts a new generation of the fill rather than inheriting work that predates that tag's invalidation.

Redis eviction of an individual index/container conservatively discards orphaned entries or coordination state instead of serving values without their expiry bookkeeping. Metadata has a shared cardinality limit and indexed expiry. Operations prune expired entries and metadata. Idle finite-TTL entry containers expire at their last entry's deadline; idle metadata containers expire independently. With mixed TTLs, expired fields are pruned on the next operation or when the last live entry expires, and cardinality remains bounded. `ttlMs: 0` preserves Redis's nonexpiring-entry behavior. Missing-key tag attachment does not retain reverse indexes. Metadata pressure conservatively discards coordination state, fencing pending fills and permitting replay; published entries remain usable.

All replicas sharing `APP_KEY_PREFIX` must use the same capacity and coordination options. The namespace is captured when the store is constructed. Supported bounds:

- `maxEntries`: 1–10,000; identities: at most 4096 UTF-8 bytes and 32 query separators.
- Tags: at most 32 distinct tags per entry/fill, each at most 1024 UTF-8 bytes.
- `metadataLimit`: 66–100,000 fields, default 4096.
- `leaseMs`: at least 30 milliseconds, default 10,000.
- `fillTimeoutMs`: at least `leaseMs`, default 30,000.
- `metadataTtlMs`: at least `fillTimeoutMs + leaseMs`, default 60,000.
- `waitTimeoutMs`: default 35,000; `pollMs`: default 25; `commandTimeoutMs`: default 5000. All durations are positive safe integers.

Values must be JSON serializable. Entry counts and coordination metadata are bounded; payload byte size is application-owned. Keep cached values small. Long loaders must cooperate with the AbortSignal: a deadline rejects the caller and fences publication but cannot terminate arbitrary JavaScript or undo its side effects. `close()` aborts active fills and closes the owned Redis client.

Redis failures propagate; there is no silent memory fallback. Wait and fill deadlines bound their respective phases, and each Redis command has a separate deadline. A command deadline closes the store and aborts other fills; recreate the store through application lifecycle recovery. A timed-out write or invalidation can have an uncertain outcome if Redis applied it before the response was lost. Retry idempotent invalidation after connectivity is restored. Do not assume a cache error rolls back business writes.

Redis ACLs need EVAL and the commands used by the script: TYPE, TIME, HGET, HSET, HDEL, HKEYS, HLEN, HINCRBY, ZADD, ZREM, ZCARD, ZRANGE, ZRANGEBYSCORE, ZREVRANGE, DEL, PEXPIRE and PERSIST. Key access can be restricted to the configured application namespace; KEYS and SCAN can remain denied.

## Upgrade from the legacy Redis driver

The new format uses `APP_KEY_PREFIX:cache:v3:{namespace-hash}:…`. Legacy per-key values and tag sets are deliberately not read or migrated. This is a cold-cache change and the new bounds reject previously unbounded settings.

1. Stop and drain old HTTP and worker processes that read or invalidate this cache. Mixed old/new processes use independent invalidation namespaces and are unsafe for shared cached business data.
2. Deploy all cache writers and invalidators with the new driver and consistent options. Expect cold fills and account for database/provider load.
3. During maintenance, remove only the legacy `APP_KEY_PREFIX:cache:*` values/tag sets using an operator-controlled, bounded SCAN procedure, excluding `cache:v3:`. Never delete the whole application namespace: queues, outbox and other infrastructure are unrelated. This cleanup is outside application operations; no SQL migration is needed.
4. A rollback also requires draining new processes and clearing legacy cache entries before restarting old workers. Otherwise old permanent values can reappear.

Integration regressions use Redis 7.4 and Bun 1.4.2, including three actual Bun processes, lease renewal, killed and paused owners, ACLs denying keyspace enumeration, metadata pressure, idle expiration and unavailable Redis. They do not replace representative load tests or a production Redis failover exercise.
