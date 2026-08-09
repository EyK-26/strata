import type FailedJobService from "./failedJobService";
import { jobRegistry } from "./jobRegistry";
import { queueConfig } from "./queueConfig";

interface QueueJobEnvelope {
  name: string;
  payload: Record<string, unknown>;
  attempts?: number;
}

async function runQueueJob(
  envelope: QueueJobEnvelope,
  failedJobs: FailedJobService,
): Promise<void> {
  const job = jobRegistry.create(envelope.name);

  if (!job) {
    throw new Error(`Unknown job "${envelope.name}".`);
  }

  const attempts = envelope.attempts ?? 0;

  try {
    await job.handle(envelope.payload);
  } catch (error) {
    const nextAttempt = attempts + 1;
    const maxAttempts = job.maxAttempts ?? queueConfig.maxAttempts;

    if (nextAttempt < maxAttempts) {
      const backoffMs = job.backoffMs ?? queueConfig.backoffMs;
      await new Promise((resolve) => setTimeout(resolve, backoffMs * nextAttempt));
      await runQueueJob(
        {
          ...envelope,
          attempts: nextAttempt,
        },
        failedJobs,
      );
      return;
    }

    await failedJobs.recordFailure({
      jobName: envelope.name,
      payload: envelope.payload,
      exception: error instanceof Error ? (error.stack ?? error.message) : String(error),
    });

    throw error;
  }
}

export type { QueueJobEnvelope };
export { runQueueJob };
