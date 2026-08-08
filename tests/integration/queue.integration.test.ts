import { describe, expect, test } from "bun:test";
import { RedisClient } from "bun";
import { Job } from "../../src/core/queue";
import {
  createFailedJobService,
  createQueueWorker,
  registerDefaultJobs,
} from "../../src/core/queue/createAppQueue";
import { jobRegistry } from "../../src/core/queue/jobRegistry";
import { QUEUE_LIST_KEY, RedisQueue } from "../../src/core/queue/redisQueue";

interface EchoPayload {
  message: string;
}

describe("Redis queue integration", () => {
  test("processes a tracked redis job", async () => {
    const redisUrl = process.env.REDIS_URL ?? "redis://redis:6379";

    registerDefaultJobs();

    const messages: string[] = [];

    class EchoJob extends Job<EchoPayload> {
      override async handle(payload: EchoPayload): Promise<void> {
        messages.push(payload.message);
      }
    }

    const echoJob = new EchoJob();
    jobRegistry.register("test.echo.integration", () => echoJob);
    jobRegistry.track("test.echo.integration", echoJob);
    const queue = new RedisQueue(redisUrl);
    const worker = createQueueWorker(redisUrl, createFailedJobService());
    const client = new RedisClient(redisUrl);

    await client.del(QUEUE_LIST_KEY);
    await queue.dispatch(echoJob, { message: "redis-integration" });

    const processed = await worker.processNext();

    expect(processed).toBe(true);
    expect(messages).toEqual(["redis-integration"]);
  });
});
