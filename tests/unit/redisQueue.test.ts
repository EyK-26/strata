import { describe, expect, test } from "bun:test";
import { Job } from "@getstrata/core/queue";
import { JobRegistry } from "@getstrata/core/queue/jobRegistry";

const jobRegistry = new JobRegistry();

import {
  QUEUE_HIGH_KEY,
  QUEUE_LIST_KEY,
  QUEUE_LOW_KEY,
  queueKeyForPriority,
  RedisQueue,
  reservationExpired,
} from "@getstrata/core/queue/redisQueue";
import { RedisClient } from "bun";

describe("reservationExpired", () => {
  test("treats a missing, blank, or stale lease as expired", () => {
    expect(reservationExpired(null, 1_000, 60_000)).toBe(true);
    expect(reservationExpired("", 1_000, 60_000)).toBe(true);
    expect(reservationExpired("nope", 1_000, 60_000)).toBe(true);
    expect(reservationExpired(String(1_000 - 60_000), 1_000, 60_000)).toBe(true);
    expect(reservationExpired(String(1_000), 1_000, 60_000)).toBe(false);
  });
});

describe("redis queue", () => {
  const redisUrl = `${process.env.REDIS_URL ?? "redis://redis:6379"}/15`;

  test("queueKeyForPriority maps priorities to redis list keys", () => {
    expect(queueKeyForPriority("high")).toBe(QUEUE_HIGH_KEY);
    expect(queueKeyForPriority("low")).toBe(QUEUE_LOW_KEY);
    expect(queueKeyForPriority("default")).toBe(QUEUE_LIST_KEY);
    expect(queueKeyForPriority()).toBe(QUEUE_LIST_KEY);
  });

  test("RedisQueue dispatches registered jobs to the configured priority list", async () => {
    const client = new RedisClient(redisUrl);
    const queue = new RedisQueue(redisUrl, jobRegistry);

    class EchoJob extends Job<{ message: string }> {
      override readonly priority = "low" as const;

      override async handle(): Promise<void> {}
    }

    const echoJob = new EchoJob();
    jobRegistry.register("test.redis.dispatch", () => echoJob);
    jobRegistry.track("test.redis.dispatch", echoJob);

    await client.del(QUEUE_LOW_KEY);
    await queue.dispatch(echoJob, { message: "queued" });

    const payload = await client.rpop(QUEUE_LOW_KEY);
    expect(payload).toContain("test.redis.dispatch");
    expect(payload).toContain("queued");
  });

  test("RedisQueue rejects unregistered jobs", async () => {
    const queue = new RedisQueue(redisUrl, jobRegistry);

    class UntrackedJob extends Job<{ message: string }> {
      override async handle(): Promise<void> {}
    }

    await expect(queue.dispatch(new UntrackedJob(), { message: "nope" })).rejects.toThrow(
      "Job is not registered with the queue worker registry.",
    );
  });
});

test("Redis producers retain their application namespace after process environment changes", async () => {
  const { RedisStreamsQueue, streamQueueKey } = await import("@getstrata/core/queue/redisStreams");
  const original = process.env.APP_KEY_PREFIX;
  const prefix = `queue-owner-${crypto.randomUUID()}`;
  const driftPrefix = `queue-drift-${crypto.randomUUID()}`;
  const url = process.env.REDIS_URL;
  if (!url) throw new Error("Owned Redis fixture is required");
  const client = new RedisClient(url);
  const registry = new JobRegistry();
  class Owned extends Job {
    static override readonly jobName = "owned-namespace";
    async handle() {}
  }
  registry.register(Owned.jobName, () => new Owned());
  process.env.APP_KEY_PREFIX = prefix;
  const lists = new RedisQueue(url, registry);
  const streams = new RedisStreamsQueue(url, registry);
  const key = queueKeyForPriority();
  process.env.APP_KEY_PREFIX = driftPrefix;
  const driftKey = queueKeyForPriority();
  try {
    await lists.dispatch(new Owned(), {});
    expect(await client.llen(key)).toBe(1);
    expect(await client.llen(driftKey)).toBe(0);
    await client.del(key);
    await streams.dispatch(new Owned(), {});
    expect(await client.send("XLEN", [streamQueueKey(key)])).toBe(1);
    expect(await client.send("XLEN", [streamQueueKey(driftKey)])).toBe(0);
  } finally {
    await client.del(key, driftKey, streamQueueKey(key), streamQueueKey(driftKey));
    lists.close();
    streams.close();
    client.close();
    if (original === undefined) delete process.env.APP_KEY_PREFIX;
    else process.env.APP_KEY_PREFIX = original;
  }
});
