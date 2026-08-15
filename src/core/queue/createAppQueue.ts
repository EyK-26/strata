import type { Queue } from "./index";
import {
  createFailedJobService,
  createProductionQueue,
  createQueueWorker,
  createTrackedJob,
  type FailedJobService,
} from "./publicQueue";

const FAILED_JOB_SERVICE_TOKEN = "core.failedJobs";

function createAppQueue(
  driver: "sync" | "async" | "redis",
  redisUrl?: string,
  failedJobs: FailedJobService = createFailedJobService(),
  registerJobs?: () => void,
): Queue {
  return createProductionQueue(driver, {
    redisUrl,
    failedJobs,
    registerJobs,
  });
}

export { registerDefaultJobs } from "../../bootstrap/queue/defaultJobs.ts";

export {
  createAppQueue,
  createFailedJobService,
  createQueueWorker,
  createTrackedJob,
  FAILED_JOB_SERVICE_TOKEN,
};
