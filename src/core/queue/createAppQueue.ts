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
import { resolveQueueConfig } from "./queueConfig";

function createAppQueue(
  driver: "sync" | "async" | "redis",
  redisUrl: string | undefined,
  failedJobs: QueueServices,
  registry: JobRegistry,
): Queue {
  return createProductionQueue(driver, {
    redisUrl,
    failedJobs,
    registry,
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
