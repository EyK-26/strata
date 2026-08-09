import { describe, expect, test } from "bun:test";
import { Job } from "../../src/core/queue";
import FailedJobRepository from "../../src/core/queue/failedJobRepository";
import FailedJobService from "../../src/core/queue/failedJobService";
import { jobRegistry } from "../../src/core/queue/jobRegistry";
import { runQueueJob } from "../../src/core/queue/jobRunner";

class FailingJob extends Job<{ marker: string }> {
  override readonly maxAttempts = 1;

  override async handle(): Promise<void> {
    throw new Error("Job failed on purpose.");
  }
}

class FlakyJob extends Job<{ marker: string }> {
  override readonly maxAttempts = 3;
  override readonly backoffMs = 0;

  override async handle(): Promise<void> {
    flakyAttempts += 1;

    if (flakyAttempts < 2) {
      throw new Error("Retry me.");
    }
  }
}

let flakyAttempts = 0;

describe("runQueueJob", () => {
  test("records permanently failed jobs", async () => {
    const failedJobs = new FailedJobService(new FailedJobRepository());
    const job = new FailingJob();
    jobRegistry.register("test.failing", () => job);

    await expect(
      runQueueJob(
        {
          name: "test.failing",
          payload: { marker: "x" },
          attempts: 0,
        },
        failedJobs,
      ),
    ).rejects.toThrow("Job failed on purpose.");

    const listed = await failedJobs.listRecent(1);
    expect(listed[0]?.job_name).toBe("test.failing");
  });

  test("retries jobs until they succeed", async () => {
    flakyAttempts = 0;
    const failedJobs = new FailedJobService(new FailedJobRepository());
    const job = new FlakyJob();
    jobRegistry.register("test.flaky", () => job);

    await expect(
      runQueueJob(
        {
          name: "test.flaky",
          payload: { marker: "x" },
          attempts: 0,
        },
        failedJobs,
      ),
    ).resolves.toBeUndefined();

    const listed = await failedJobs.listRecent(10);
    expect(listed.some((job) => job.job_name === "test.flaky")).toBe(false);
  });

  test("rejects unknown jobs", async () => {
    const failedJobs = new FailedJobService(new FailedJobRepository());

    await expect(
      runQueueJob(
        {
          name: "missing.job",
          payload: {},
          attempts: 0,
        },
        failedJobs,
      ),
    ).rejects.toThrow('Unknown job "missing.job".');
  });
});
