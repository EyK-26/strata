import { FAILED_JOB_SERVICE_TOKEN } from "@getstrata/core/contracts/serviceTokens";
import type { Queue } from "./index";
import {
  createFailedJobService,
  createProductionQueue,
  createQueueServices,
  createQueueWorker,
  createSystemQueueServices,
  createTrackedJob,
  type QueueServices,
} from "./publicQueue";
import { resolveQueueConfig } from "./queueConfig";

function createAppQueue(
  driver: "sync" | "async" | "redis",
  redisUrl: string | undefined,
  failedJobs: QueueServices,
  registerJobs?: () => void,
): Queue {
  return createProductionQueue(driver, {
    redisUrl,
    failedJobs,
    registerJobs,
  });
}

export type { QueueInvocation, QueueInvocationConfig, QueueServices } from "./queueServices";
export {
  createAppQueue,
  createFailedJobService,
  createQueueServices,
  createQueueWorker,
  createSystemQueueServices,
  createTrackedJob,
  FAILED_JOB_SERVICE_TOKEN,
  resolveQueueConfig,
};
