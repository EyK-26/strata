import {
  createAppQueue,
  createFailedJobService,
  resolveQueueConfig,
} from "@getstrata/core/queue/createAppQueue";
import { jobRegistry } from "@getstrata/core/queue/jobRegistry";
import { resolveApplicationQueue } from "@getstrata/core/runtime/applicationRegistry";
import type { StrataCommand } from "./types.ts";

type QueueFailedBoot = () => unknown | Promise<unknown>;

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

  const jobId = Number(id);
  if (!Number.isSafeInteger(jobId) || jobId <= 0)
    throw new Error("queue:retry requires a positive integer failed job id.");
  await boot?.();
  const failedJobs = createFailedJobService();
  // App boot owns its configured queue; standalone CLI dispatch owns and closes its queue.
  const queue = boot
    ? resolveApplicationQueue()
    : createAppQueue(resolveQueueConfig().driver, process.env.REDIS_URL, failedJobs);
  try {
    await failedJobs.retry(jobId, async (failedJob) => {
      const job = jobRegistry.create(failedJob.job_name);
      if (!job) throw new Error(`Unknown job "${failedJob.job_name}".`);
      jobRegistry.track(failedJob.job_name, job);
      if (failedJob.job_id !== null && failedJob.job_id !== undefined) {
        if (!queue.replay)
          throw new Error("Configured queue cannot preserve the failed-job identity");
        await queue.replay(job, failedJob.payload, failedJob.job_id);
      } else await queue.dispatch(job, failedJob.payload);
    });
    console.log(`Enqueued failed job #${jobId}.`);
  } finally {
    if (!boot) await queue.close?.();
  }
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
