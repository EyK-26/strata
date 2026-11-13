import { FAILED_JOB_SERVICE_TOKEN } from "@getstrata/core/contracts/serviceTokens";
import type { Queue } from "./index";
import type { JobRegistry } from "./jobRegistry";
import {
  createFailedJobService,
  createProductionQueue,
  createQueueServices,
  createQueueWorker,
  createSystemQueueServices,
  createTrackedJob,
  type QueueServices,
} from "./publicQueue";
import type { QueueRetryPolicy } from "./queueConfig";
import { resolveQueueConfig } from "./queueConfig";

function createAppQueue(
  driver: "sync" | "async" | "redis",
  redisUrl: string | undefined,
  failedJobs: QueueServices,
  registry: JobRegistry,
  retryPolicy?: QueueRetryPolicy,
): Queue {
  return createProductionQueue(driver, {
    redisUrl,
    failedJobs,
    registry,
    retryPolicy,
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
