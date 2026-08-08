import { createAppContext } from "../../bootstrap/context";
import {
  installGracefulShutdownSignals,
  registerShutdownHandler,
} from "../../core/lifecycle/gracefulShutdown";
import {
  createFailedJobService,
  createQueueWorker,
  registerDefaultJobs,
} from "../../core/queue/createAppQueue";
import { closeDatabase } from "../../db/connection";

async function queueWorkCommand(): Promise<void> {
  const redisUrl = process.env.REDIS_URL;

  if (!redisUrl) {
    throw new Error("queue:work requires REDIS_URL to be set.");
  }

  createAppContext();
  registerDefaultJobs();

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

export { queueWorkCommand };
