import { afterAll, describe, expect, test } from "bun:test";
import { RedisClient } from "bun";
import { Job } from "../../src/core/queue";
import { jobRegistry } from "../../src/core/queue/jobRegistry";
import {
  QUEUE_HIGH_KEY,
  QUEUE_LIST_KEY,
  QUEUE_LOW_KEY,
  queueKeyForPriority,
  RedisQueue,
} from "../../src/core/queue/redisQueue";

afterAll(() => {
  // no mocks
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
    const queue = new RedisQueue(redisUrl);

    class EchoJob extends Job<{ message: string }> {
      override readonly priority = "low" as const;

      override async handle(): Promise<void> {
        // handled by worker tests
      }
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
    const queue = new RedisQueue(redisUrl);

    class UntrackedJob extends Job<{ message: string }> {
      override async handle(): Promise<void> {
        // no-op
      }
    }

    await expect(queue.dispatch(new UntrackedJob(), { message: "nope" })).rejects.toThrow(
      "Job is not registered with the queue worker registry.",
    );
  });
});
