import { createFailedJobService } from "@getstrata/core/queue/createAppQueue";
import { jobRegistry } from "@getstrata/core/queue/jobRegistry";
import { runQueueJob } from "@getstrata/core/queue/jobRunner";
import type { StrataCommand } from "./types.ts";

type QueueFailedBoot = () => void | Promise<void>;

async function queueFailedCommand(boot?: QueueFailedBoot): Promise<void> {
  await boot?.();
  const failedJobs = createFailedJobService();
  const jobs = await failedJobs.listRecent();

  if (jobs.length === 0) {
    console.log("No failed jobs.");
    return;
  }

  for (const job of jobs) {
    console.log(`#${job.id} ${job.job_name} failed at ${job.failed_at.toISOString()}`);
  }
}

async function queueRetryCommand(id?: string, boot?: QueueFailedBoot): Promise<void> {
  if (!id) {
    throw new Error("queue:retry requires a failed job id.");
  }

  await boot?.();
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

async function queueFlushFailedCommand(boot?: QueueFailedBoot): Promise<void> {
  await boot?.();
  const deleted = await createFailedJobService().flush();
  console.log(`Removed ${deleted} failed job(s).`);
}

function createQueueFailedCommands(boot?: QueueFailedBoot): {
  queueFailedCommand: StrataCommand;
  queueRetryCommand: StrataCommand;
  queueFlushFailedCommand: StrataCommand;
} {
  return {
    queueFailedCommand: async () => queueFailedCommand(boot),
    queueRetryCommand: async (id?: string) => queueRetryCommand(id, boot),
    queueFlushFailedCommand: async () => queueFlushFailedCommand(boot),
  };
}

export type { QueueFailedBoot };
export {
  createQueueFailedCommands,
  queueFailedCommand,
  queueFlushFailedCommand,
  queueRetryCommand,
};
