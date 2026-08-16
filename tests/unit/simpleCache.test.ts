import { describe, expect, test } from "bun:test";
import { SimpleCache } from "@getstrata/core/cache/simpleCache";

describe("SimpleCache", () => {
  test("deduplicates inflight requests for the same key", async () => {
    const cache = new SimpleCache(1_000, 10);
    let loaderCalls = 0;

    const loader = async () => {
      loaderCalls += 1;
      await Bun.sleep(20);
      return { value: 42 };
    };

    const [first, second] = await Promise.all([
      cache.getOrSet("answer", loader),
      cache.getOrSet("answer", loader),
    ]);

    expect(first).toEqual({ value: 42 });
    expect(second).toEqual({ value: 42 });
    expect(loaderCalls).toBe(1);
  });

  test("expires cached entries and can repopulate them", async () => {
    const cache = new SimpleCache(10, 10);

    cache.set("temporary", 1);
    expect(cache.get<number>("temporary")).toBe(1);

    await Bun.sleep(20);

    expect(cache.get<number>("temporary")).toBeUndefined();

    const refreshedValue = await cache.getOrSet("temporary", async () => 2);
    expect(refreshedValue).toBe(2);
    expect(cache.get<number>("temporary")).toBe(2);
  });

  test("evicts the least recently used entry when max size is reached", async () => {
    const cache = new SimpleCache(1_000, 2);

    cache.set("first", 1);
    await Bun.sleep(2);
    cache.set("second", 2);
    await Bun.sleep(2);
    cache.get("first");
    await Bun.sleep(2);
    cache.set("third", 3);

    expect(cache.get<number>("first")).toBe(1);
    expect(cache.get<number>("second")).toBeUndefined();
    expect(cache.get<number>("third")).toBe(3);
  });
});
