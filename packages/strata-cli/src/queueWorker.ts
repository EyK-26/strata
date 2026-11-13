import {
  installGracefulShutdownSignals,
  LifecycleCoordinator,
} from "@getstrata/core/lifecycle/gracefulShutdown";

import type { QueueCommandApplication } from "./queueFailed";

type QueueWorkerBoot = () => QueueCommandApplication | Promise<QueueCommandApplication>;

async function runQueueWorkerCommand(options: {
  boot: QueueWorkerBoot;
  lifecycle?: LifecycleCoordinator;
}): Promise<void> {
  const lifecycle = options.lifecycle ?? new LifecycleCoordinator();
  if (lifecycle.isShuttingDown) throw new Error("Cannot start a worker during shutdown.");
  let application: QueueCommandApplication | undefined;
  let booting: Promise<unknown> | undefined;
  let stopping = false;
  const name = `queue:${crypto.randomUUID()}`;
  lifecycle.register(
    `${name}:stop`,
    () => {
      stopping = true;
      return application?.application.stop().then((result) => {
        if (!result.successful)
          throw new Error("Queue application shutdown did not complete cleanly.");
      });
    },
    "stop",
  );
  lifecycle.register(
    `${name}:drain`,
    async () => {
      // Completion, including failed startup/run, means no admitted worker remains.
      await booting?.catch(() => {});
    },
    "drain",
  );
  lifecycle.register(
    `${name}:flush`,
    async () => {
      // Canonical application owns provider flushing.
    },
    "flush",
  );
  lifecycle.register(
    `${name}:close`,
    async () => {
      const result = await application?.application.stop();
      if (result && !result.successful)
        throw new Error("Queue application shutdown did not complete cleanly.");
    },
    "close",
  );
  const uninstall = installGracefulShutdownSignals(undefined, lifecycle);
  let failure: unknown;
  let failed = false;
  try {
    booting = (async () => {
      application = await options.boot();
    })();
    await booting;
    if (!stopping && !lifecycle.isShuttingDown) {
      if (!application) throw new Error("Queue boot did not return its application.");
      if (!application.worker)
        throw new Error("Queue boot must configure an application-owned worker transport.");
      console.log("[queue:work] Starting Redis queue polling; idle until jobs are available.");
      await application.worker.start();
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

export type { QueueWorkerBoot };
export { runQueueWorkerCommand };
