import { describe, expect, test } from "bun:test";
import { createCacheStore } from "@getstrata/core/cache/createCacheStore";
import { CacheRepository } from "@getstrata/core/cache/repository";

const redisUrl = process.env.REDIS_URL?.trim() ?? "";

const describeRedis = redisUrl ? describe : describe.skip;

describeRedis("redis cache shared across clients", () => {
  test("propagates tag flush between independent cache repositories", async () => {
    const options = {
      driver: "redis" as const,
      ttlMs: 60_000,
      maxEntries: 100,
      redisUrl,
      namespace: `cache-shared-${crypto.randomUUID()}:cache:v3:`,
    };
    const storeA = createCacheStore(options);
    const storeB = createCacheStore(options);
    const cacheA = new CacheRepository(storeA);
    const cacheB = new CacheRepository(storeB);
    const key = `integration:shared:${Date.now()}`;

    try {
      await cacheA.tags("integration-shared").remember(key, async () => ({ value: 42 }));

      expect(await cacheB.get<{ value: number }>(key)).toEqual({ value: 42 });

      await cacheA.tags("integration-shared").flush();

      expect(await cacheB.get(key)).toBeUndefined();
    } finally {
      try {
        await cacheA.flush();
      } finally {
        await Promise.all([cacheA.close(), cacheB.close()]);
      }
    }
  });

  test("supports concurrent readers after a shared write", async () => {
    const options = {
      driver: "redis" as const,
      ttlMs: 60_000,
      maxEntries: 100,
      redisUrl,
      namespace: `cache-shared-${crypto.randomUUID()}:cache:v3:`,
    };
    const storeA = createCacheStore(options);
    const storeB = createCacheStore(options);
    const cacheA = new CacheRepository(storeA);
    const cacheB = new CacheRepository(storeB);
    const key = `integration:concurrent:${Date.now()}`;

    try {
      await cacheA.remember(key, async () => "shared-value");

      const [first, second] = await Promise.all([cacheA.get<string>(key), cacheB.get<string>(key)]);

      expect(first).toBe("shared-value");
      expect(second).toBe("shared-value");
    } finally {
      try {
        await cacheA.flush();
      } finally {
        await Promise.all([cacheA.close(), cacheB.close()]);
      }
    }
  });
});
