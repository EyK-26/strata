import { expect, test } from "bun:test";
import { Job, type JobContext } from "@getstrata/core/queue";
import type FailedJobService from "@getstrata/core/queue/failedJobService";
import { jobRegistry } from "@getstrata/core/queue/jobRegistry";
import { runQueueJob } from "@getstrata/core/queue/jobRunner";

test("one-based attempts share logical identity across synchronous retries", async () => {
  const seen: JobContext[] = [];
  class Retry extends Job {
    override readonly maxAttempts = 3;
    override readonly backoffMs = 0;
    override async handle(_payload: object, context?: JobContext) {
      if (!context) throw new Error("Missing execution context");
      seen.push(context);
      if (seen.length < 3) throw new Error("transient");
    }
  }
  const name = `attempt-${crypto.randomUUID()}`;
  jobRegistry.register(name, () => new Retry());
  const failures: unknown[] = [];
  const failedJobs: Pick<FailedJobService, "recordFailure"> = {
    async recordFailure(record) {
      failures.push(record);
      return {
        id: 1,
        job_name: record.jobName,
        job_id: record.jobId ?? null,
        payload: record.payload,
        exception: record.exception,
        failed_at: new Date(),
      };
    },
  };
  await runQueueJob({ name, payload: {} }, failedJobs);
  expect(seen.map((context) => context.attempt)).toEqual([1, 2, 3]);
  expect(new Set(seen.map((context) => context.jobId)).size).toBe(1);
  expect(new Set(seen.map((context) => context.signal)).size).toBe(1);
  expect(failures).toEqual([]);
});
