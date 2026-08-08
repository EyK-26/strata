import { describe, expect, test } from "bun:test";
import { QueueWorker } from "../../src/core/queue/redisQueue";
import FailedJobService from "../../src/core/queue/failedJobService";
import FailedJobRepository from "../../src/core/queue/failedJobRepository";

describe("QueueWorker", () => {
  test("requestStop exits the run loop", async () => {
    const worker = new QueueWorker("redis://invalid", new FailedJobService(new FailedJobRepository()), 1);
    worker.requestStop();

    await worker.run();

    expect(worker.isRunning()).toBe(false);
  });
});
