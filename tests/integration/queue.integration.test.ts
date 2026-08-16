import { describe, expect, test } from "bun:test";
import { registerDefaultJobs } from "@getstrata/bootstrap/queue/defaultJobs";
import { Job } from "@getstrata/core/queue";
import { createFailedJobService } from "@getstrata/core/queue/createAppQueue";
import { jobRegistry } from "@getstrata/core/queue/jobRegistry";
import { type QueueJobEnvelope, runQueueJob } from "@getstrata/core/queue/jobRunner";
import { RedisClient } from "bun";
import { QUEUE_LIST_KEY, RedisQueue } from "../../src/core/queue/redisQueue";

interface EchoPayload {
  message: string;
}

describe("Redis queue integration", () => {
  test("dispatches and runs a tracked redis job envelope", async () => {
    const redisUrl = `${process.env.REDIS_URL ?? "redis://redis:6379"}/15`;

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
    const client = new RedisClient(redisUrl);
    const failedJobs = createFailedJobService();

    await client.del(QUEUE_LIST_KEY);
    await queue.dispatch(echoJob, { message: "redis-integration" });

    const popped = await client.brpop(QUEUE_LIST_KEY, 2);
    expect(popped).not.toBeNull();

    const [, rawPayload] = popped as [string, string];
    const envelope = JSON.parse(rawPayload) as QueueJobEnvelope;
    await runQueueJob(envelope, failedJobs);

    expect(messages).toEqual(["redis-integration"]);
  });
});
