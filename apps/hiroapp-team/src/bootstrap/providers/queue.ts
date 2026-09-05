import type { ServiceProvider } from "@getstrata/core/contracts/di";
import { CORE_QUEUE_TOKEN } from "@getstrata/core/contracts/serviceTokens";
import {
  createAppQueue,
  createFailedJobService,
  FAILED_JOB_SERVICE_TOKEN,
} from "@getstrata/core/queue/createAppQueue";

const queueProvider: ServiceProvider = {
  name: "starter.queue",
  register({ container }) {
    const driver = (process.env.QUEUE_DRIVER ?? "sync") as "sync" | "async" | "redis";
    const failedJobs = createFailedJobService();
    container.set(FAILED_JOB_SERVICE_TOKEN, failedJobs);
    container.set(CORE_QUEUE_TOKEN, createAppQueue(driver, process.env.REDIS_URL, failedJobs));
  },
};

export default queueProvider;
