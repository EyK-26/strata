import {
  installGracefulShutdownSignals,
  registerShutdownHandler,
} from "@getstrata/core/lifecycle/gracefulShutdown";
import { createFailedJobService, createQueueWorker } from "@getstrata/core/queue/createAppQueue";

type QueueWorkerBoot = () => void | Promise<void>;
type QueueWorkerClose = () => void | Promise<void>;

async function runQueueWorkerCommand(options: {
  boot: QueueWorkerBoot;
  close?: QueueWorkerClose;
  failedJobs?: ReturnType<typeof createFailedJobService>;
}): Promise<void> {
  const redisUrl = process.env.REDIS_URL;

  if (!redisUrl) {
    throw new Error("queue:work requires REDIS_URL to be set.");
  }

  await options.boot();

  const failedJobs = options.failedJobs ?? createFailedJobService();

  console.log("[queue:work] Listening for jobs on Redis...");
  const worker = createQueueWorker(redisUrl, failedJobs);

  registerShutdownHandler("queue-worker", async () => {
    worker.requestStop();
  });

  if (options.close) {
    registerShutdownHandler("database", async () => {
      await options.close?.();
    });
  }

  installGracefulShutdownSignals();

  await worker.run();
  console.log("[queue:work] Worker stopped.");
}

export type { QueueWorkerBoot, QueueWorkerClose };
export { runQueueWorkerCommand };
