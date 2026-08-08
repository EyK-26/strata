import { createAppContext } from "../../bootstrap/context";
import { registerDefaultJobs } from "../../core/queue/createAppQueue";
import { QueueWorker } from "../../core/queue/redisQueue";

async function queueWorkCommand(): Promise<void> {
  const redisUrl = process.env.REDIS_URL;

  if (!redisUrl) {
    throw new Error("queue:work requires REDIS_URL to be set.");
  }

  createAppContext();
  registerDefaultJobs();

  console.log("[queue:work] Listening for jobs on Redis...");
  const worker = new QueueWorker(redisUrl);
  await worker.run();
}

export { queueWorkCommand };
