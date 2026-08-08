import { createFailedJobService } from "../../core/queue/createAppQueue";
import { jobRegistry } from "../../core/queue/jobRegistry";
import { runQueueJob } from "../../core/queue/jobRunner";

async function queueFailedCommand(): Promise<void> {
  const failedJobs = createFailedJobService();
  const jobs = await failedJobs.listRecent();

  if (jobs.length === 0) {
    console.log("No failed jobs.");
    return;
  }

  for (const job of jobs) {
    console.log(
      `#${job.id} ${job.job_name} failed at ${job.failed_at.toISOString()}`,
    );
  }
}

async function queueRetryCommand(id?: string): Promise<void> {
  if (!id) {
    throw new Error("queue:retry requires a failed job id.");
  }

  const failedJobs = createFailedJobService();
  const failedJob = await failedJobs.retry(Number.parseInt(id, 10));

  const job = jobRegistry.create(failedJob.job_name);

  if (!job) {
    throw new Error(`Unknown job "${failedJob.job_name}".`);
  }

  await runQueueJob(
    {
      name: failedJob.job_name,
      payload: failedJob.payload,
      attempts: 0,
    },
    failedJobs,
  );

  console.log(`Retried failed job #${id}.`);
}

async function queueFlushFailedCommand(): Promise<void> {
  const deleted = await createFailedJobService().flush();
  console.log(`Removed ${deleted} failed job(s).`);
}

export { queueFailedCommand, queueFlushFailedCommand, queueRetryCommand };
