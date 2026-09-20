import type { StrataCommandMap } from "@getstrata/cli";

async function queueWorkCommand(): Promise<void> {
  const redisUrl = process.env.REDIS_URL;

  if (!redisUrl) {
    throw new Error("queue:work requires REDIS_URL to be set.");
  }

  const { bootstrapApp } = await import("../bootstrap/createApp.ts");
  const { closeDatabase } = await import("../bootstrap/database.ts");
  const { installGracefulShutdownSignals, registerShutdownHandler } = await import(
    "@getstrata/core/lifecycle/gracefulShutdown"
  );
  const { createFailedJobService, createQueueWorker } = await import(
    "@getstrata/core/queue/createAppQueue"
  );

  await bootstrapApp({ migrate: false });

  console.log("[queue:work] Listening for jobs on Redis...");
  const worker = createQueueWorker(redisUrl, createFailedJobService());

  registerShutdownHandler("queue-worker", async () => {
    worker.requestStop();
  });
  registerShutdownHandler("database", async () => {
    await closeDatabase();
  });
  installGracefulShutdownSignals();

  await worker.run();
  console.log("[queue:work] Worker stopped.");
}

const commands: StrataCommandMap = {
  "queue:work": async () => queueWorkCommand,
};

export { commands, queueWorkCommand };
