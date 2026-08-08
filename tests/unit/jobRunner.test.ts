import { beforeAll, describe, expect, test } from "bun:test";
import { Job } from "../../src/core/queue";
import FailedJobRepository from "../../src/core/queue/failedJobRepository";
import FailedJobService from "../../src/core/queue/failedJobService";
import { jobRegistry } from "../../src/core/queue/jobRegistry";
import { runQueueJob } from "../../src/core/queue/jobRunner";

beforeAll(async () => {
  const { freshDatabase } = await import("../../src/db/migrations/runner");
  await freshDatabase({ seed: true });
});

class FailingJob extends Job<{ marker: string }> {
  override readonly maxAttempts = 1;

  override async handle(): Promise<void> {
    throw new Error("Job failed on purpose.");
  }
}

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
});
