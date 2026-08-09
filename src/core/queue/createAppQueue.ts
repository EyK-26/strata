import { resolveApplicationCache } from "../../bootstrap/applicationRegistry";
import DispatchWebhookJob from "../jobs/dispatchWebhookJob";
import InvalidateCacheTagsJob from "../jobs/invalidateCacheTagsJob";
import type { Queue } from "./index";
import { jobRegistry } from "./jobRegistry";
import {
  createFailedJobService,
  createProductionQueue,
  createQueueWorker,
  createTrackedJob,
  type FailedJobService,
} from "./publicQueue";

const FAILED_JOB_SERVICE_TOKEN = "core.failedJobs";

function registerDefaultJobs(): void {
  jobRegistry.register("cache.invalidate-tags", () => {
    return new InvalidateCacheTagsJob(resolveApplicationCache());
  });
  jobRegistry.register("webhook.dispatch", () => new DispatchWebhookJob());
}

function createAppQueue(
  driver: "sync" | "async" | "redis",
  redisUrl?: string,
  failedJobs: FailedJobService = createFailedJobService(),
): Queue {
  return createProductionQueue(driver, {
    redisUrl,
    failedJobs,
    registerJobs: registerDefaultJobs,
  });
}

export {
  createAppQueue,
  createFailedJobService,
  createQueueWorker,
  createTrackedJob,
  FAILED_JOB_SERVICE_TOKEN,
  registerDefaultJobs,
};
