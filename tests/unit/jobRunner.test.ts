import { describe, expect, test } from "bun:test";
import { Job } from "@getstrata/core/queue";
import { FailedJobRepository } from "@getstrata/core/queue/failedJobRepository";
import { FailedJobService } from "@getstrata/core/queue/failedJobService";
import { jobRegistry } from "@getstrata/core/queue/jobRegistry";
import { parseQueueJobEnvelope, runQueueJob } from "@getstrata/core/queue/jobRunner";

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
  test("lease cancellation stops local retries without recording a business failure", async () => {
    const controller = new AbortController();
    let entered!: () => void;
    const started = new Promise<void>((resolve) => {
      entered = resolve;
    });
    let attempts = 0;
    let failures = 0;
    class Cancelled extends Job {
      override readonly maxAttempts = 3;
      override readonly backoffMs = 10000;
      async handle() {
        attempts++;
        entered();
        throw new Error("retryable failure");
      }
    }
    jobRegistry.register("test.cancelled", () => new Cancelled());
    const running = runQueueJob(
      { name: "test.cancelled", payload: {} },
      {
        recordFailure: async () => {
          failures++;
        },
      } as never,
      { context: { jobId: "transport-id", signal: controller.signal } },
    );
    await started;
    controller.abort(new Error("Lease lost"));
    await expect(running).rejects.toThrow();
    expect(attempts).toBe(1);
    expect(failures).toBe(0);
  });
  test("envelope validation rejects primitive and non-object payloads", () => {
    for (const raw of ["null", "1", "true", '"text"'])
      expect(parseQueueJobEnvelope(raw)).toBeNull();
    jobRegistry.register("test.validated-envelope", () => new FlakyJob());
    for (const fields of [
      { cancellable: "true" },
      { cancellable: true },
      { deadlineAtMs: 0 },
      { deadlineAtMs: -1 },
      { deadlineAtMs: "1" },
      { deadlineAtMs: 1.5 },
      { jobId: "" },
      { jobId: 1 },
      { attempts: -1 },
      { attempts: 0.5 },
      { attempts: "1" },
    ])
      expect(
        parseQueueJobEnvelope(
          JSON.stringify({ name: "test.validated-envelope", payload: {}, ...fields }),
        ),
      ).toBeNull();
    expect(
      parseQueueJobEnvelope(
        JSON.stringify({
          name: "test.validated-envelope",
          payload: {},
          jobId: "stable",
          attempts: 2,
        }),
      ),
    ).toEqual({ name: "test.validated-envelope", payload: {}, jobId: "stable", attempts: 2 });
    for (const payload of [null, 1, "text"])
      expect(
        parseQueueJobEnvelope(JSON.stringify({ name: "test.validated-envelope", payload })),
      ).toBeNull();
  });
});
