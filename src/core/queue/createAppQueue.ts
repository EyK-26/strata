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
import type { QueueRetryPolicy, QueueRuntimeConfig } from "./queueConfig";
import { resolveQueueConfig } from "./queueConfig";

function createAppQueue(
  driver: "sync" | "async" | "redis",
  redisUrl: string | undefined,
  failedJobs: QueueServices,
  registry: JobRegistry,
  retryPolicy?: QueueRetryPolicy,
  runtime?: QueueRuntimeConfig,
): Queue {
  return createProductionQueue(driver, {
    redisUrl,
    failedJobs,
    registry,
    retryPolicy,
    runtime,
  });
}

export type { QueueHandoff, QueueIdentity } from "@getstrata/core/queue/queueHandoff";
export { createIdentityQueue, createQueueHandoff } from "@getstrata/core/queue/queueHandoff";
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
