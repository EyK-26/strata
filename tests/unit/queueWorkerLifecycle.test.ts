import { afterAll, describe, expect, mock, test } from "bun:test";
import { RedisClient } from "bun";
import { Job } from "../../src/core/queue";
import FailedJobRepository from "../../src/core/queue/failedJobRepository";
import FailedJobService from "../../src/core/queue/failedJobService";
import { jobRegistry } from "../../src/core/queue/jobRegistry";
import { QUEUE_HIGH_KEY, QueueWorker } from "../../src/core/queue/redisQueue";

afterAll(() => {
  mock.restore();
});

describe("QueueWorker lifecycle", () => {
  const redisUrl = `${process.env.REDIS_URL ?? "redis://localhost:6379"}/15`;

  async function clearQueueKeys(): Promise<void> {
    const client = new RedisClient(redisUrl);
    await client.del(QUEUE_HIGH_KEY);
    await client.del("workhub:queue:default");
    await client.del("workhub:queue:low");
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

  test("processNext ignores unknown job names without calling runQueueJob", async () => {
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
});
