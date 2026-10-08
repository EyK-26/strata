import { discoverJobs } from "@getstrata/bootstrap/discoverJobs";
import { registerDefaultJobs } from "@getstrata/bootstrap/queue/defaultJobs";
import type { ServiceProvider } from "@getstrata/core/contracts/di";
import { CORE_QUEUE_TOKEN } from "@getstrata/core/contracts/serviceTokens";
import {
  createAppQueue,
  createFailedJobService,
  FAILED_JOB_SERVICE_TOKEN,
} from "@getstrata/core/queue/createAppQueue";

const queueProvider: ServiceProvider = {
  name: "starter.queue",
  async register({ container, onCleanup }) {
    const driver = (process.env.QUEUE_DRIVER ?? "sync") as "sync" | "async" | "redis";
    const failedJobs = createFailedJobService();
    container.set(FAILED_JOB_SERVICE_TOKEN, failedJobs);
    registerDefaultJobs();
    await discoverJobs();
    const queue = createAppQueue(driver, process.env.REDIS_URL, failedJobs);
    onCleanup(() => queue.close?.(), driver === "async" ? "drain" : "close");
    container.set(CORE_QUEUE_TOKEN, queue);
  },
};

export default queueProvider;
