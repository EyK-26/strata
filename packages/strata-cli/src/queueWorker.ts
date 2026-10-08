import {
  installGracefulShutdownSignals,
  LifecycleCoordinator,
} from "@getstrata/core/lifecycle/gracefulShutdown";
import { createFailedJobService, createQueueWorker } from "@getstrata/core/queue/createAppQueue";

type QueueWorkerBoot = () => unknown | Promise<unknown>;
type QueueWorkerClose = () => unknown | Promise<unknown>;

async function runQueueWorkerCommand(options: {
  boot: QueueWorkerBoot;
  close?: QueueWorkerClose;
  flush?: QueueWorkerClose;
  drain?: QueueWorkerClose;
  lifecycle?: LifecycleCoordinator;
  failedJobs?: ReturnType<typeof createFailedJobService>;
}): Promise<void> {
  const redisUrl = process.env.REDIS_URL;
  if (!redisUrl) throw new Error("queue:work requires REDIS_URL to be set.");
  const lifecycle = options.lifecycle ?? new LifecycleCoordinator();
  if (lifecycle.isShuttingDown) throw new Error("Cannot start a worker during shutdown.");
  let worker: ReturnType<typeof createQueueWorker> | undefined;
  let running: Promise<void> | undefined;
  let booting: Promise<unknown> | undefined;
  let stopping = false;
  const name = `queue:${crypto.randomUUID()}`;
  lifecycle.register(
    `${name}:stop`,
    () => {
      stopping = true;
      worker?.requestStop();
    },
    "stop",
  );
  lifecycle.register(
    `${name}:drain`,
    async () => {
      // Completion, including failed startup/run, means no admitted worker remains.
      await booting?.catch(() => {});
      await running?.catch(() => {});
      await options.drain?.();
    },
    "drain",
  );
  lifecycle.register(
    `${name}:flush`,
    async () => {
      await options.flush?.();
    },
    "flush",
  );
  lifecycle.register(
    `${name}:close`,
    async () => {
      try {
        await worker?.close?.();
      } finally {
        await options.close?.();
      }
    },
    "close",
  );
  lifecycle.register(
    `${name}:force`,
    () => {
      worker?.requestStop();
      worker?.close?.();
    },
    "force",
  );
  const uninstall = installGracefulShutdownSignals(undefined, lifecycle);
  let failure: unknown;
  let failed = false;
  try {
    booting = (async () => {
      await options.boot();
    })();
    await booting;
    if (!stopping && !lifecycle.isShuttingDown) {
      worker = createQueueWorker(redisUrl, options.failedJobs ?? createFailedJobService());
      console.log("[queue:work] Listening for jobs on Redis...");
      running = worker.run();
      await running;
      console.log("[queue:work] Worker stopped.");
    }
  } catch (error) {
    failed = true;
    failure = error;
  }
  const result = await lifecycle.shutdown("WORKER_FINISHED");
  uninstall();
  if (!result.successful)
    throw new AggregateError(
      [...(failed ? [failure] : []), ...result.errors.map((entry) => entry.error)],
      "Queue startup/runtime or shutdown failed.",
    );
  if (failed) throw failure;
}

export type { QueueWorkerBoot, QueueWorkerClose };
export { runQueueWorkerCommand };
