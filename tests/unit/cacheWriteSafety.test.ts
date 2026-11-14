import { describe, expect, test } from "bun:test";
import { createCacheStore } from "@getstrata/core/cache/createCacheStore";

type CacheStore = ReturnType<typeof createCacheStore>;

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

const redisUrl = process.env.REDIS_URL?.trim() ?? "";
for (const driver of ["array", "redis"] as const) {
  const suite = driver === "redis" && !redisUrl ? describe.skip : describe;
  suite(`${driver} cache write safety`, () => {
    function store(capacity = 10): CacheStore {
      return createCacheStore({
        driver,
        ttlMs: 60_000,
        maxEntries: capacity,
        redisUrl,
        namespace: `write-safety-${crypto.randomUUID()}:`,
      });
    }
    async function usingStore(run: (cache: CacheStore) => Promise<void>, capacity = 10) {
      const cache = store(capacity);
      try {
        await run(cache);
      } finally {
        try {
          await cache.clear();
        } finally {
          await cache.close?.();
        }
      }
    }

    test("empty keys cannot defeat capacity limits", async () => {
      await usingStore(async (cache) => {
        await cache.set("", 1);
        await cache.set("new", 2);
        expect(await cache.size()).toBe(1);
        expect(await cache.get("")).toBeUndefined();
        expect(await cache.get("new")).toBe(2);
      }, 1);
    });

    test("explicit writes fence old fills and preserve existing cached tags", async () => {
      await usingStore(async (cache) => {
        const started = deferred<void>();
        const old = deferred<number>();
        if (!cache.getOrSetTagged) throw new Error("Test store must support tags");
        const pending = cache.getOrSetTagged("stock", async () => {
          started.resolve();
          return old.promise;
        }, ["inventory"]);
        await started.promise;
        await cache.set("stock", 2);
        old.resolve(1);
        expect(await pending).toBe(1);
        expect(await cache.get("stock")).toBe(2);
        // Existing cached tags survive an explicit replacement too.
        await cache.attachTags("stock", ["inventory"]);
        await cache.set("stock", 3);
        expect(await cache.flushTags(["inventory"])).toBe(1);
        expect(await cache.get("stock")).toBeUndefined();
      });
    });

    test("an invalid write leaves the pending fill owner intact", async () => {
      await usingStore(async (cache) => {
        const started = deferred<void>();
        const result = deferred<number>();
        const pending = cache.getOrSet("item", async () => {
          started.resolve();
          return result.promise;
        });
        await started.promise;
        await expect(cache.set("item", 2, NaN)).rejects.toThrow("ttlMs");
        result.resolve(1);
        expect(await pending).toBe(1);
        expect(await cache.get("item")).toBe(1);
      });
    });

    test("a failed loader releases ownership and permits a fresh tagged fill", async () => {
      await usingStore(async (cache) => {
        await expect(
          cache.getOrSet("item", async () => {
            throw new Error("upstream failed");
          }),
        ).rejects.toThrow("upstream failed");
        expect(await cache.get("item")).toBeUndefined();
        if (!cache.getOrSetTagged) throw new Error("Test store must support tags");
        expect(await cache.getOrSetTagged("item", async () => 2, ["stock"])).toBe(2);
        expect(await cache.flushTags(["stock"])).toBe(1);
        expect(await cache.get("item")).toBeUndefined();
      });
    });

    for (const ttl of [NaN, Infinity, -1]) {
      test(`invalid TTL ${ttl} rejects before mutation or loader invocation`, async () => {
        await usingStore(async (cache) => {
          await cache.set("item", 1);
          await expect(cache.set("item", 2, ttl)).rejects.toThrow("ttlMs");
          expect(await cache.get("item")).toBe(1);
          let calls = 0;
          for (const key of ["item", "missing"]) {
            await expect(
              cache.getOrSet(
                key,
                async () => {
                  calls++;
                  return 3;
                },
                ttl,
              ),
            ).rejects.toThrow("ttlMs");
          }
          expect(calls).toBe(0);
          expect(await cache.get("missing")).toBeUndefined();
        });
      });
    }
  });
}
