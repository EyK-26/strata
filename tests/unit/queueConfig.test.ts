import { describe, expect, test } from "bun:test";
import {
  readQueueVisibilityMs,
  resolveQueueConfig,
  resolveRedisQueueTransport,
  snapshotQueueRetryPolicy,
} from "../../src/core/queue/queueConfig";

describe("queue configuration snapshots", () => {
  test("defaults and explicit environments produce independent immutable policies", () => {
    expect(resolveQueueConfig({})).toEqual({ driver: "sync", maxAttempts: 3, backoffMs: 1000 });
    const input = { QUEUE_DRIVER: "redis", QUEUE_MAX_ATTEMPTS: "5", QUEUE_BACKOFF_MS: "250" };
    const config = resolveQueueConfig(input);
    input.QUEUE_DRIVER = "sync";
    input.QUEUE_MAX_ATTEMPTS = "1";
    input.QUEUE_BACKOFF_MS = "0";
    expect(config).toEqual({ driver: "redis", maxAttempts: 5, backoffMs: 250 });
    expect(Object.isFrozen(config)).toBe(true);
    expect(resolveQueueConfig(input)).toEqual({ driver: "sync", maxAttempts: 1, backoffMs: 0 });
  });
  test("rejects invalid drivers, fractional or unbounded retry settings before effects", () => {
    for (const driver of ["horizon", "", "REDIS"])
      expect(() => resolveQueueConfig({ QUEUE_DRIVER: driver })).toThrow();
    for (const value of ["0", "-1", "1.5", "nope", "Infinity", "9007199254740992"])
      expect(() => resolveQueueConfig({ QUEUE_MAX_ATTEMPTS: value })).toThrow();
    for (const value of ["-1", "1.5", "nope", "Infinity", "2147483648"])
      expect(() => resolveQueueConfig({ QUEUE_BACKOFF_MS: value })).toThrow();
    const input = { maxAttempts: 2, backoffMs: 10 };
    const snapshot = snapshotQueueRetryPolicy(input);
    input.maxAttempts = 99;
    input.backoffMs = 99;
    expect(snapshot).toEqual({ maxAttempts: 2, backoffMs: 10 });
    expect(Object.isFrozen(snapshot)).toBe(true);
  });
  test("transport and visibility adapters validate explicit sources", () => {
    expect(resolveRedisQueueTransport({})).toBe("lists");
    expect(readQueueVisibilityMs({})).toBe(60000);
    expect(resolveRedisQueueTransport({ QUEUE_REDIS_TRANSPORT: "streams" })).toBe("streams");
    expect(() => resolveRedisQueueTransport({ QUEUE_REDIS_TRANSPORT: "true" })).toThrow(
      "QUEUE_REDIS_TRANSPORT",
    );
    for (const value of ["0", "-1", "29", "31.5", "oops", "Infinity", "2147483648"])
      expect(() => readQueueVisibilityMs({ QUEUE_VISIBILITY_MS: value })).toThrow(
        "QUEUE_VISIBILITY_MS",
      );
    expect(readQueueVisibilityMs({ QUEUE_VISIBILITY_MS: "200" })).toBe(200);
  });
});
