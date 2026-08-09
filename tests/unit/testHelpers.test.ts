import { describe, expect, test } from "bun:test";
import { createMockCache, createMockDependencies, mockFetch } from "./testHelpers";

describe("testHelpers", () => {
  test("createMockCache default implementation satisfies the cache contract", async () => {
    const cache = createMockCache();

    expect(await cache.get("key")).toBeUndefined();
    expect(await cache.remember("key", async () => "remembered")).toBe("remembered");
    expect(await cache.forget("key")).toBe(true);
    expect(await cache.flush()).toBeUndefined();
    expect(await cache.getOrSet("key", async () => "loaded")).toBe("loaded");
    expect(await cache.invalidate("key")).toBe(true);
    expect(await cache.invalidateByPrefix("prefix:")).toBe(0);
    expect(await cache.clear()).toBeUndefined();
    expect(await cache.size()).toBe(0);

    const tagged = cache.tags("reports");
    expect(await tagged.remember("tagged", async () => "tagged-value")).toBe("tagged-value");
    expect(await tagged.flush()).toBe(0);
  });

  test("createMockCache accepts overrides", async () => {
    const cache = createMockCache({
      get: async () => "cached" as never,
      forget: async () => false,
      flush: async () => undefined,
      invalidate: async () => false,
      invalidateByPrefix: async () => 2,
      clear: async () => undefined,
      size: async () => 5,
    });

    expect((await cache.get("key")) as string | undefined).toBe("cached");
    expect(await cache.remember("key", async () => "remembered")).toBe("remembered");
    expect(await cache.forget("key")).toBe(false);
    expect(await cache.flush()).toBeUndefined();
    expect(await cache.getOrSet("key", async () => "loaded")).toBe("loaded");
    expect(await cache.invalidate("key")).toBe(false);
    expect(await cache.invalidateByPrefix("prefix:")).toBe(2);
    expect(await cache.clear()).toBeUndefined();
    expect(await cache.size()).toBe(5);

    const tagged = cache.tags("reports");
    expect(await tagged.remember("tagged", async () => "tagged-value")).toBe("tagged-value");
    expect(await tagged.flush()).toBe(0);
  });

  test("createMockDependencies wraps container and cache", () => {
    const container = { resolve: () => "service" } as never;
    const cache = createMockCache({ size: async () => 3 });

    expect(createMockDependencies(container, cache)).toEqual({ container, cache });
  });

  test("mockFetch returns the provided implementation as fetch", async () => {
    const fetchImpl = mockFetch(async () => new Response("ok"));

    await expect(fetchImpl("https://example.test")).resolves.toMatchObject({
      status: 200,
    });
  });
});
