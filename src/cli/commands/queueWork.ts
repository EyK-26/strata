import { createAppContext } from "@getstrata/bootstrap/context";
import { registerDefaultJobs } from "@getstrata/bootstrap/queue/defaultJobs";
import { assertProductionSecrets } from "@getstrata/bootstrap/secretsGuard";
import { assertWorkHubProductionSecrets } from "../../config/productionSecrets";
import {
  installGracefulShutdownSignals,
  registerShutdownHandler,
} from "../../core/lifecycle/gracefulShutdown";
import { createFailedJobService, createQueueWorker } from "../../core/queue/createAppQueue";
import { closeDatabase } from "../../db/connection";
import { registerWebhookJobs } from "../../modules/webhook/registerWebhookJobs";

async function queueWorkCommand(): Promise<void> {
  const redisUrl = process.env.REDIS_URL;

  if (!redisUrl) {
    throw new Error("queue:work requires REDIS_URL to be set.");
  }

  assertProductionSecrets();
  assertWorkHubProductionSecrets();
  createAppContext();
  registerDefaultJobs();
  registerWebhookJobs();

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
