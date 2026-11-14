import { describe, expect, test } from "bun:test";
import { createCacheStore } from "@getstrata/core/cache/createCacheStore";
import { CacheRepository, createGuardedCache } from "@getstrata/core/cache/repository";

const redisUrl = process.env.REDIS_URL?.trim() ?? "";
for (const driver of ["array", "redis"] as const) {
  const suite = driver === "redis" && !redisUrl ? describe.skip : describe;
  suite(`${driver} expiration contract`, () => {
    async function usingCache(
      run: (cache: CacheRepository) => Promise<void>,
      ttlMs: number | null = 60_000,
      maxEntries = 10,
    ) {
      const store = createCacheStore({
        driver,
        redisUrl,
        ttlMs,
        maxEntries,
        namespace: `ttl-contract-${crypto.randomUUID()}:`,
      });
      const cache = new CacheRepository(store);
      try {
        await run(cache);
      } finally {
        try {
          await cache.flush();
        } finally {
          await cache.close();
        }
      }
    }

    test("positive and default TTLs expire; forever survives and remains tagged", async () => {
      await usingCache(async (cache) => {
        await cache.forever("converted", 5);
        await cache.put("converted", 6, 500);
        await cache.put("upgraded", 7, 500);
        await cache.forever("upgraded", 8);
        await cache.put("default", 1);
        await cache.tags("orders").put("finite", 2, 500);
        await cache.forever("forever", 3);
        await cache.tags("orders").forever("tagged", 4);
        expect(await cache.get("default")).toBe(1);
        expect(await cache.get("finite")).toBe(2);
        await Bun.sleep(600);
        expect(await cache.get("default")).toBeUndefined();
        expect(await cache.get("finite")).toBeUndefined();
        expect(await cache.get("converted")).toBeUndefined();
        expect(await cache.get("upgraded")).toBe(8);
        expect(await cache.get("forever")).toBe(3);
        expect(await cache.get("tagged")).toBe(4);
        expect(await cache.tags("orders").flush()).toBe(1);
        expect(await cache.get("tagged")).toBeUndefined();
        expect(await cache.forget("forever")).toBe(true);
      }, 500);
    });

    for (const ttl of [0, -1, Number.MIN_SAFE_INTEGER]) {
      test(`${ttl} removes replacements; remember returns a hit or an uncached loader result`, async () => {
        await usingCache(async (cache) => {
          await cache.forever("item", 1);
          let loads = 0;
          expect(
            await cache.remember(
              "item",
              async () => {
                loads++;
                return 2;
              },
              ttl,
            ),
          ).toBe(1);
          expect(loads).toBe(0);
          await cache.put("item", 3, ttl);
          expect(await cache.get("item")).toBeUndefined();
          expect(
            await cache.tags("orders").remember(
              "item",
              async () => {
                loads++;
                return 4;
              },
              ttl,
            ),
          ).toBe(4);
          expect(loads).toBe(1);
          expect(await cache.get("item")).toBeUndefined();
          expect(await cache.tags("orders").flush()).toBe(0);
          await cache.tags("orders").forever("item", 5);
          await cache.tags("orders").put("item", 6, ttl);
          expect(await cache.get("item")).toBeUndefined();
          expect(await cache.size()).toBe(0);
          // An uncached result need not be serializable by a persistent backend.
          expect(await cache.remember("void", async () => undefined, ttl)).toBeUndefined();
        });
      });
    }

    for (const write of ["zero", "negative", "forever", "tag flush"] as const) {
      test(`${write} fences an older pending fill`, async () => {
        await usingCache(async (cache) => {
          const entered = Promise.withResolvers<void>();
          const result = Promise.withResolvers<number>();
          const pending = cache.tags("orders").remember("item", async () => {
            entered.resolve();
            return result.promise;
          });
          await entered.promise;
          if (write === "tag flush") await cache.tags("orders").flush();
          else if (write === "forever") await cache.tags("orders").forever("item", 2);
          else await cache.put("item", 2, write === "zero" ? 0 : -1);
          result.resolve(1);
          expect(await pending).toBe(1);
          expect(await cache.get("item")).toBe(write === "forever" ? 2 : undefined);
          expect(await cache.tags("orders").flush()).toBe(write === "forever" ? 1 : 0);
        });
      });
    }

    test("forever entries remain subject to capacity eviction", async () => {
      await usingCache(
        async (cache) => {
          await cache.forever("old", 1);
          await cache.forever("new", 2);
          expect(await cache.size()).toBe(1);
          expect(await cache.get("old")).toBeUndefined();
          expect(await cache.get("new")).toBe(2);
        },
        1000,
        1,
      );
    });

    for (const ttl of [0, -1, null]) {
      test(`omitted TTL respects configured default ${ttl}`, async () => {
        await usingCache(async (cache) => {
          await cache.put("item", 1);
          expect(await cache.get("item")).toBe(ttl === null ? 1 : undefined);
          await cache.forget("item");
          expect(await cache.remember("item", async () => 2)).toBe(2);
          expect(await cache.get("item")).toBe(ttl === null ? 2 : undefined);
        }, ttl);
      });
    }

    test("invalid tagged writes reject without losing cached values or running loaders", async () => {
      await usingCache(async (cache) => {
        for (const ttl of [NaN, Infinity, -Infinity, 0.5, Number.MAX_SAFE_INTEGER + 1]) {
          await cache.forever("item", 1);
          await expect(cache.tags("orders").put("item", 2, ttl)).rejects.toThrow("ttlMs");
          expect(await cache.get("item")).toBe(1);
          let calls = 0;
          await expect(
            cache.tags("orders").remember(
              "item",
              async () => {
                calls++;
                return 3;
              },
              ttl,
            ),
          ).rejects.toThrow("ttlMs");
          expect(calls).toBe(0);
        }
      });
    });

    test("scoped put and forever reject stale authority without mutating the backend", async () => {
      await usingCache(async (backend) => {
        let active = true;
        const assertActive = () => {
          if (!active) throw new Error("scope closed");
        };
        const scoped = createGuardedCache(backend, {
          assertActive,
          operation: async (work) => {
            assertActive();
            return work();
          },
        });
        const tags = scoped.tags("orders");
        await scoped.put("item", 1);
        await tags.forever("tagged", 2);
        active = false;
        for (const call of [
          () => scoped.put("item", 3),
          () => scoped.forever("item", 3),
          () => tags.put("tagged", 3),
          () => tags.forever("tagged", 3),
        ]) {
          await expect(call()).rejects.toThrow("scope closed");
        }
        expect(await backend.get("item")).toBe(1);
        expect(await backend.get("tagged")).toBe(2);
      });
    });
  });
}
