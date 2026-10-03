import { afterAll, describe, expect, mock, test } from "bun:test";
import { Job } from "@getstrata/core/queue";
import { FailedJobRepository } from "@getstrata/core/queue/failedJobRepository";
import { FailedJobService } from "@getstrata/core/queue/failedJobService";
import { jobRegistry } from "@getstrata/core/queue/jobRegistry";
import {
  QUEUE_HIGH_KEY,
  QUEUE_LIST_KEY,
  QUEUE_LOW_KEY,
  QueueWorker,
  queueInvalidKey,
  queueProcessingKey,
  queueProcessingLeaseKey,
  reclaimExpiredQueueReservations,
} from "@getstrata/core/queue/redisQueue";
import { RedisClient } from "bun";

afterAll(() => {
  mock.restore();
});

describe("QueueWorker lifecycle", () => {
  const redisUrl = `${process.env.REDIS_URL ?? "redis://localhost:6379"}/15`;

  async function clearQueueKeys(): Promise<void> {
    const client = new RedisClient(redisUrl);
    for (const key of [QUEUE_HIGH_KEY, QUEUE_LIST_KEY, QUEUE_LOW_KEY]) {
      await client.del(key);
      await client.del(queueInvalidKey(key));
      await client.del(queueProcessingKey(key));
      await client.del(queueProcessingLeaseKey(key));
    }
    client.close();
  }

  test("requestStop exits the run loop", async () => {
    const worker = new QueueWorker(
      "redis://invalid",
      new FailedJobService(new FailedJobRepository()),
      1,
    );
    worker.requestStop();

    await worker.run();

    expect(worker.isRunning()).toBe(false);
  });

  test("processNext runs a job from the high priority queue", async () => {
    const messages: string[] = [];

    class EchoJob extends Job<{ message: string }> {
      override async handle(payload: { message: string }): Promise<void> {
        messages.push(payload.message);
        expect(await client.llen(queueProcessingKey(QUEUE_HIGH_KEY))).toBe(1);
      }
    }

    const echoJob = new EchoJob();
    jobRegistry.register("test.redis.echo", () => echoJob);
    jobRegistry.track("test.redis.echo", echoJob);

    const client = new RedisClient(redisUrl);
    await clearQueueKeys();
    await client.lpush(
      QUEUE_HIGH_KEY,
      JSON.stringify({
        name: "test.redis.echo",
        payload: { message: "from-redis" },
        attempts: 0,
      }),
    );

    const worker = new QueueWorker(redisUrl, new FailedJobService(new FailedJobRepository()), 1);

    await expect(worker.processNext()).resolves.toBe(true);
    expect(messages).toEqual(["from-redis"]);
    expect(await client.llen(queueProcessingKey(QUEUE_HIGH_KEY))).toBe(0);
    client.close();
  });

  test("processNext returns false when no jobs are available", async () => {
    await clearQueueKeys();

    const worker = new QueueWorker(redisUrl, new FailedJobService(new FailedJobRepository()), 1);

    await expect(worker.processNext()).resolves.toBe(false);
  }, 10000);

  test("processNext logs failures from runQueueJob", async () => {
    const errorLogs: unknown[] = [];
    const originalConsoleError = console.error;

    console.error = (...args: unknown[]) => {
      errorLogs.push(args);
    };

    try {
      class FailingJob extends Job<Record<string, never>> {
        override async handle(): Promise<void> {
          throw new Error("boom");
        }
      }

      const failingJob = new FailingJob();
      jobRegistry.register("test.redis.fail", () => failingJob);
      jobRegistry.track("test.redis.fail", failingJob);

      const client = new RedisClient(redisUrl);
      await clearQueueKeys();
      await client.lpush(
        QUEUE_HIGH_KEY,
        JSON.stringify({ name: "test.redis.fail", payload: {}, attempts: 0 }),
      );

      const worker = new QueueWorker(redisUrl, new FailedJobService(new FailedJobRepository()), 1);

      await expect(worker.processNext()).resolves.toBe(true);
      expect(errorLogs.some((entry) => String(entry).includes("[QueueWorker] Job failed:"))).toBe(
        true,
      );
    } finally {
      console.error = originalConsoleError;
    }
  });

  test("processNext quarantines unknown job names without calling runQueueJob", async () => {
    const errorLogs: unknown[] = [];
    const originalConsoleError = console.error;

    console.error = (...args: unknown[]) => {
      errorLogs.push(args);
    };

    try {
      const client = new RedisClient(redisUrl);
      await clearQueueKeys();
      await client.lpush(
        QUEUE_HIGH_KEY,
        JSON.stringify({ name: "missing.job", payload: {}, attempts: 0 }),
      );

      const worker = new QueueWorker(redisUrl, new FailedJobService(new FailedJobRepository()), 1);

      await expect(worker.processNext()).resolves.toBe(true);
      expect(await client.llen(queueInvalidKey(QUEUE_HIGH_KEY))).toBe(1);
      expect(errorLogs.some((entry) => String(entry).includes("Ignoring unknown job name"))).toBe(
        true,
      );
      expect(errorLogs.some((entry) => String(entry).includes("[QueueWorker] Job failed:"))).toBe(
        false,
      );
    } finally {
      console.error = originalConsoleError;
    }
  });

  test("reclaims an unacked reservation and leaves a fresh lease in processing", async () => {
    await clearQueueKeys();
    const client = new RedisClient(redisUrl);
    const payload = JSON.stringify({ name: "missing.job", payload: {}, attempts: 0 });
    const processingKey = queueProcessingKey(QUEUE_HIGH_KEY);
    const leaseKey = queueProcessingLeaseKey(QUEUE_HIGH_KEY);

    try {
      await client.lpush(processingKey, payload);
      await client.hset(leaseKey, payload, String(Date.now()));
      expect(await reclaimExpiredQueueReservations(client)).toBe(0);
      expect(await client.llen(processingKey)).toBe(1);

      await client.hset(leaseKey, payload, String(Date.now() - 120_000));
      expect(await reclaimExpiredQueueReservations(client)).toBe(1);
      expect(await client.llen(processingKey)).toBe(0);
      expect(await client.llen(QUEUE_HIGH_KEY)).toBe(1);
    } finally {
      client.close();
    }
  });
});
