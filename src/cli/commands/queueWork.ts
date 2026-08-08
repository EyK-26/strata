import { createAppContext } from "../../bootstrap/context";
import { registerDefaultJobs } from "../../core/queue/createAppQueue";
import { createQueueWorker, createFailedJobService } from "../../core/queue/createAppQueue";

async function queueWorkCommand(): Promise<void> {
  const redisUrl = process.env.REDIS_URL;

  if (!redisUrl) {
    throw new Error("queue:work requires REDIS_URL to be set.");
  }

  createAppContext();
  registerDefaultJobs();

  console.log("[queue:work] Listening for jobs on Redis...");
  const worker = createQueueWorker(redisUrl, createFailedJobService());
  await worker.run();
}

export { queueWorkCommand };
