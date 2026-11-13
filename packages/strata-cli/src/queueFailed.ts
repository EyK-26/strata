import type { Application } from "@getstrata/core/contracts/application";
import type { Queue } from "@getstrata/core/queue";
import type { QueueInvocation, QueueServices } from "@getstrata/core/queue/createAppQueue";
import { jobRegistry } from "@getstrata/core/queue/jobRegistry";
import type { StrataCommand } from "./types.ts";

interface QueueCommandApplication {
  readonly application: Application;
  readonly invoke: QueueInvocation;
  readonly queueServices: QueueServices;
  readonly queue: Queue;
  readonly worker?: { start(): Promise<void> };
}
type QueueFailedBoot = () => QueueCommandApplication | Promise<QueueCommandApplication>;
async function withQueueApplication<T>(
  boot: QueueFailedBoot,
  work: (app: QueueCommandApplication) => Promise<T>,
): Promise<T> {
  const app = await boot();
  let value: T | undefined;
  const errors: unknown[] = [];
  try {
    value = await work(app);
  } catch (error) {
    errors.push(error);
  }
  try {
    const result = await app.application.stop();
    if (!result.successful)
      errors.push(new Error("Queue application shutdown did not complete cleanly."));
  } catch (error) {
    errors.push(error);
  }
  if (errors.length === 1) throw errors[0];
  if (errors.length) throw new AggregateError(errors, "Queue command or shutdown failed.");
  return value as T;
}
async function queueFailedCommand(boot: QueueFailedBoot): Promise<void> {
  await withQueueApplication(boot, async ({ queueServices }) => {
    const jobs = await queueServices.listRecent();
    if (!jobs.length) console.log("No failed jobs.");
    for (const job of jobs)
      console.log(`#${job.id} ${job.job_name} failed at ${job.failed_at.toISOString()}`);
  });
}
async function queueRetryCommand(id: string | undefined, boot: QueueFailedBoot): Promise<void> {
  const jobId = Number(id);
  if (!id || !Number.isSafeInteger(jobId) || jobId <= 0)
    throw new Error("queue:retry requires a positive integer failed job id.");
  await withQueueApplication(boot, async ({ queueServices, queue }) => {
    await queueServices.retry(jobId, async (failedJob) => {
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
  });
}
async function queueFlushFailedCommand(boot: QueueFailedBoot): Promise<void> {
  await withQueueApplication(boot, async ({ queueServices }) => {
    console.log(`Removed ${await queueServices.flush()} failed job(s).`);
  });
}
function createQueueFailedCommands(boot: QueueFailedBoot): {
  queueFailedCommand: StrataCommand;
  queueRetryCommand: StrataCommand;
  queueFlushFailedCommand: StrataCommand;
} {
  return {
    queueFailedCommand: () => queueFailedCommand(boot),
    queueRetryCommand: (id?: string) => queueRetryCommand(id, boot),
    queueFlushFailedCommand: () => queueFlushFailedCommand(boot),
  };
}

export type { QueueCommandApplication, QueueFailedBoot };
export {
  createQueueFailedCommands,
  queueFailedCommand,
  queueFlushFailedCommand,
  queueRetryCommand,
};
