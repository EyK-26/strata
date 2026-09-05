import type { ServiceProvider } from "@getstrata/bootstrap/contracts";
import { registerDefaultJobs } from "@getstrata/bootstrap/queue/defaultJobs";
import { CORE_QUEUE_TOKEN } from "@getstrata/core/contracts/serviceTokens";
import {
  createAppQueue,
  createFailedJobService,
  FAILED_JOB_SERVICE_TOKEN,
} from "@getstrata/core/queue/createAppQueue";
import { registerHiroappJobs } from "../../jobs/sendNotification.ts";

const queueProvider: ServiceProvider = {
  name: "hiroapp.queue",
  register({ container }) {
    registerDefaultJobs();
    registerHiroappJobs();
    const driver = (process.env.QUEUE_DRIVER ?? "sync") as "sync" | "async" | "redis";
    const failedJobs = createFailedJobService();
    container.set(FAILED_JOB_SERVICE_TOKEN, failedJobs);
    container.set(CORE_QUEUE_TOKEN, createAppQueue(driver, process.env.REDIS_URL, failedJobs));
  },
};

export { queueProvider };
