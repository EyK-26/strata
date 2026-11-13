import FailedJobRepository from "@getstrata/core/queue/failedJobRepository";
import FailedJobService from "./failedJobService.ts";
import type { Job, Queue } from "./index.ts";
import type { JobRegistry } from "./jobRegistry.ts";
import { runQueueJob } from "./jobRunner.ts";
import {
  type QueueRetryPolicy,
  type QueueRuntimeConfig,
  resolveQueueConfig,
  resolveQueueRuntimeConfig,
  snapshotQueueRetryPolicy,
  snapshotQueueRuntimeConfig,
} from "./queueConfig";
import {
  createFailedJobService,
  createQueueServices,
  createSystemQueueServices,
  type QueueServices,
} from "./queueServices";
import { QueueWorker, RedisQueue } from "./redisQueue.ts";
import { RedisStreamsQueue, RedisStreamsWorker } from "./redisStreams";
import { ResilientQueue } from "./resilientQueue.ts";

function createTrackedJob<TPayload extends object>(
  registry: JobRegistry,
  name: string,
  job: Job<TPayload>,
): Job<TPayload> {
  return registry.track(name, job);
}

function createProductionQueue(
  driver: "sync" | "async" | "redis",
  options: {
    redisUrl?: string;
    failedJobs: QueueServices;
    registry: JobRegistry;
    retryPolicy?: QueueRetryPolicy;
    runtime?: QueueRuntimeConfig;
  },
): Queue {
  const failedJobs = options.failedJobs;

  if (driver === "redis") {
    if (!options.redisUrl) {
      throw new Error('QUEUE_DRIVER="redis" requires REDIS_URL to be set.');
    }

    const runtime = snapshotQueueRuntimeConfig(options.runtime ?? resolveQueueRuntimeConfig());
    return runtime.transport === "streams"
      ? new RedisStreamsQueue(options.redisUrl, options.registry, runtime.queueKeys)
      : new RedisQueue(options.redisUrl, options.registry, runtime.queueKeys);
  }

  return new ResilientQueue(
    failedJobs,
    options.registry,
    driver === "async",
    snapshotQueueRetryPolicy(options.retryPolicy ?? resolveQueueConfig()),
  );
}

function createQueueWorker(
  redisUrl: string,
  failedJobs: Pick<QueueServices, "recordFailure" | "runAttempt">,
  registry: JobRegistry,
  options: { readonly runtime?: QueueRuntimeConfig; readonly retryPolicy?: QueueRetryPolicy } = {},
): QueueWorker | RedisStreamsWorker {
  const runtime = snapshotQueueRuntimeConfig(options.runtime ?? resolveQueueRuntimeConfig());
  const retry = snapshotQueueRetryPolicy(options.retryPolicy ?? resolveQueueConfig());
  return runtime.transport === "streams"
    ? new RedisStreamsWorker(
        redisUrl,
        failedJobs,
        registry,
        5,
        runtime.queueKeys,
        retry,
        runtime.visibilityMs,
      )
    : new QueueWorker(
        redisUrl,
        failedJobs,
        registry,
        5,
        runtime.queueKeys,
        retry,
        runtime.visibilityMs,
      );
}

export type { QueueHandoff, QueueIdentity } from "@getstrata/core/queue/queueHandoff";
export { createIdentityQueue, createQueueHandoff } from "@getstrata/core/queue/queueHandoff";
export type { QueueInvocation, QueueInvocationConfig, QueueServices } from "./queueServices";
export {
  createFailedJobService,
  createProductionQueue,
  createQueueServices,
  createQueueWorker,
  createSystemQueueServices,
  createTrackedJob,
  FailedJobRepository,
  FailedJobService,
  QueueWorker,
  RedisQueue,
  ResilientQueue,
  runQueueJob,
};
