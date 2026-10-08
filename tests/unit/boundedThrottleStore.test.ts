import { describe, expect, test } from "bun:test";
import { BoundedThrottleStore } from "../../src/core/runtime/boundedThrottleStore";

describe("bounded process-local windows", () => {
  test("rejects invalid TTL and storage bounds", () => {
    for (const window of [-1, Infinity, NaN, 2_147_483_648])
      expect(() => new BoundedThrottleStore(window)).toThrow("window");
    for (const maxBuckets of [0, 0.5, Infinity, 1_000_001])
      expect(() => new BoundedThrottleStore(10, { maxBuckets })).toThrow("bounds");
    for (const pruneBatchSize of [0, 0.5, Infinity, 1025])
      expect(() => new BoundedThrottleStore(10, { pruneBatchSize })).toThrow("bounds");
  });

  test("sustained distinct identities saturate without evicting an existing lockout", () => {
    let now = 0;
    const store = new BoundedThrottleStore(
      100,
      { maxBuckets: 1024, pruneBatchSize: 16 },
      () => now,
    );
    expect(store.consume("hot")).toBe(1);
    expect(store.consume("hot")).toBe(2);
    for (let i = 0; i < 100_000; i++) store.consume(`identity-${i}`);
    expect(store.stats().retainedBuckets).toBe(1024);
    expect(store.consume("new")).toBeNull();
    expect(store.consume("hot")).toBe(3);
    now = 100;
    expect(store.consume("fresh")).toBe(1);
    expect(store.stats().prunedOnLastConsume).toBe(16);
    expect(store.stats().retainedBuckets).toBe(1009);
    for (let i = 0; i < 64; i++) {
      store.consume("fresh");
      expect(store.stats().prunedOnLastConsume).toBeLessThanOrEqual(16);
    }
    expect(store.stats().retainedBuckets).toBe(1);
    store.clear();
    expect(store.stats().retainedBuckets).toBe(0);
    store.dispose();
    store.dispose();
    expect(store.consume("after-disposal")).toBeNull();
    expect(store.stats()).toEqual({ retainedBuckets: 0, prunedOnLastConsume: 0, disposed: true });
  });

  test("a directly expired key resets even when the pruning batch stops before it", () => {
    let now = 0;
    const store = new BoundedThrottleStore(10, { maxBuckets: 4, pruneBatchSize: 1 }, () => now);
    for (const key of ["a", "b", "c", "d"]) store.consume(key);
    now = 10;
    expect(store.consume("d")).toBe(1);
    expect(store.stats().prunedOnLastConsume).toBe(1);
    now = 15;
    expect(store.consume("d")).toBe(2);
    expect(store.consume("new")).toBe(1);
    const defaults = new BoundedThrottleStore(0);
    expect(defaults.consume("a")).toBe(1);
    expect(defaults.consume("a")).toBe(1);
    defaults.dispose();
  });
});
