import {
  installGracefulShutdownSignals,
  registerShutdownHandler,
} from "@getstrata/core/lifecycle/gracefulShutdown";
import { createFailedJobService, createQueueWorker } from "@getstrata/core/queue/createAppQueue";

type QueueWorkerBoot = () => unknown | Promise<unknown>;
type QueueWorkerClose = () => unknown | Promise<unknown>;

async function runQueueWorkerCommand(options: {
  boot: QueueWorkerBoot;
  close?: QueueWorkerClose;
  failedJobs?: ReturnType<typeof createFailedJobService>;
}): Promise<void> {
  const redisUrl = process.env.REDIS_URL;

  if (!redisUrl) {
    throw new Error("queue:work requires REDIS_URL to be set.");
  }

  let worker: ReturnType<typeof createQueueWorker> | undefined;
  let closePromise: Promise<void> | undefined;
  const close = (): Promise<void> => {
    closePromise ??= (async () => {
      try {
        worker?.close?.();
      } finally {
        await options.close?.();
      }
    })();
    return closePromise;
  };
  const unregister: Array<() => void> = [];
  let failure: unknown;
  let failed = false;
  try {
    await options.boot();
    const failedJobs = options.failedJobs ?? createFailedJobService();
    worker = createQueueWorker(redisUrl, failedJobs);
    const activeWorker = worker;
    console.log("[queue:work] Listening for jobs on Redis...");
    const running = activeWorker.run();
    unregister.push(
      registerShutdownHandler("queue-worker", async () => {
        activeWorker.requestStop();
        await running;
      }),
    );
    unregister.push(registerShutdownHandler("queue-application", close));
    installGracefulShutdownSignals();
    await running;
    console.log("[queue:work] Worker stopped.");
  } catch (error) {
    failed = true;
    failure = error;
  }
  for (const remove of unregister) remove();
  worker?.requestStop();
  try {
    await close();
  } catch (error) {
    if (failed)
      throw new AggregateError([failure, error], "Queue startup/runtime and cleanup failed.", {
        cause: failure,
      });
    throw error;
  }
  if (failed) throw failure;
}

export type { QueueWorkerBoot, QueueWorkerClose };
export { runQueueWorkerCommand };
