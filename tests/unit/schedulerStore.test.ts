import { expect, test } from "bun:test";
import { RedisSchedulerLeaseStore, SingleRunnerLeaseStore } from "../../src/core/scheduler/leases";

test("local lease expiry rejects stale completion and release, and preserves a completed high-water mark", async () => {
  const store = new SingleRunnerLeaseStore();
  const old = { taskId: "task", occurrenceId: "1000", token: "old" };
  const replacement = { ...old, token: "new" };
  expect(await store.acquire(old, 20)).toBe(true);
  expect(await store.acquire(replacement, 20)).toBe(false);
  await Bun.sleep(25);
  expect(await store.renew(old, 20)).toBe(false);
  expect(await store.complete(old)).toBe(false);
  expect(await store.acquire(replacement, 1000)).toBe(true);
  await store.release(old);
  expect(await store.renew(replacement, 1000)).toBe(true);
  expect(await store.complete(replacement)).toBe(true);
  expect(await store.acquire(old, 20)).toBe(false);
  expect(await store.acquire({ ...old, occurrenceId: "999" }, 20)).toBe(false);
  const later = { ...old, occurrenceId: "2000" };
  expect(await store.acquire(later, 1000)).toBe(true);
  await store.release(later);
  expect(await store.acquire(later, 1000)).toBe(true);
  await store.release({ ...old, taskId: "missing" });
  expect(await store.renew({ ...old, taskId: "missing" }, 20)).toBe(false);
  expect(await store.complete({ ...old, taskId: "missing" })).toBe(false);
});

test("borrowed Redis clients retain ownership, malformed responses and hung commands fail visibly", async () => {
  const malformed = new RedisSchedulerLeaseStore({
    redisUrl: "redis://unused",
    namespace: "test",
    client: { send: async () => "malformed" },
  });
  expect(
    () => new RedisSchedulerLeaseStore({ redisUrl: "redis://unused", namespace: " " }),
  ).toThrow("namespace");
  const lease = { taskId: "task", occurrenceId: "one", token: "owner" };
  await expect(malformed.acquire(lease, 100)).rejects.toThrow("Invalid scheduler store response");
  await expect(malformed.acquire(lease, 0)).rejects.toThrow("TTL");
  malformed.close();
  const hung = new RedisSchedulerLeaseStore({
    redisUrl: "redis://unused",
    namespace: "test",
    commandTimeoutMs: 10,
    client: { send: () => new Promise(() => {}) },
  });
  await expect(hung.acquire(lease, 100)).rejects.toThrow("deadline");
  hung.close();
  expect(
    () =>
      new RedisSchedulerLeaseStore({
        redisUrl: "redis://unused",
        namespace: "test",
        commandTimeoutMs: 0,
      }),
  ).toThrow("timeout");
});
