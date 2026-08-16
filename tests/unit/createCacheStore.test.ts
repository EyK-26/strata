import { describe, expect, test } from "bun:test";
import { createCacheStore } from "@getstrata/core/cache/createCacheStore";

describe("createCacheStore", () => {
  test("creates an array-backed cache store by default", async () => {
    const store = createCacheStore({
      driver: "array",
      ttlMs: 1_000,
      maxEntries: 10,
    });

    await store.set("key", "value");
    expect(await store.get<string>("key")).toBe("value");
  });

  test("requires REDIS_URL when the redis driver is selected", () => {
    expect(() =>
      createCacheStore({
        driver: "redis",
        ttlMs: 1_000,
        maxEntries: 10,
      }),
    ).toThrow('CACHE_DRIVER="redis" requires REDIS_URL to be set.');
  });

  test("creates a redis-backed cache store when configured", async () => {
    const redisUrl = process.env.REDIS_URL;

    if (!redisUrl) {
      return;
    }

    const store = createCacheStore({
      driver: "redis",
      ttlMs: 1_000,
      maxEntries: 10,
      redisUrl,
    });

    await store.clear();
    await store.set("redis-key", { ok: true });
    expect(await store.get<{ ok: boolean }>("redis-key")).toEqual({ ok: true });

    await store.attachTags("redis-key", ["demo"]);
    expect(await store.flushTags(["demo"])).toBe(1);
    expect(await store.get("redis-key")).toBeUndefined();
  });
});
