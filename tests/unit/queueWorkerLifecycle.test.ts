import { describe, expect, test } from "bun:test";
import FailedJobRepository from "../../src/core/queue/failedJobRepository";
import FailedJobService from "../../src/core/queue/failedJobService";
import { QueueWorker } from "../../src/core/queue/redisQueue";

describe("QueueWorker", () => {
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
});
