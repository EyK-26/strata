import FailedJobRepository from "@getstrata/core/queue/failedJobRepository";
import FailedJobService from "./failedJobService.ts";
import type { Job, Queue } from "./index.ts";
import type { JobRegistry } from "./jobRegistry.ts";
import { runQueueJob } from "./jobRunner.ts";
import { resolveRedisQueueTransport } from "./queueConfig";
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
  },
): Queue {
  const failedJobs = options.failedJobs;

  if (driver === "redis") {
    if (!options.redisUrl) {
      throw new Error('QUEUE_DRIVER="redis" requires REDIS_URL to be set.');
    }

    return resolveRedisQueueTransport() === "streams"
      ? new RedisStreamsQueue(options.redisUrl, options.registry)
      : new RedisQueue(options.redisUrl, options.registry);
  }

  return new ResilientQueue(failedJobs, options.registry, driver === "async");
}

function createQueueWorker(
  redisUrl: string,
  failedJobs: Pick<QueueServices, "recordFailure" | "runAttempt">,
  registry: JobRegistry,
): QueueWorker | RedisStreamsWorker {
  return resolveRedisQueueTransport() === "streams"
    ? new RedisStreamsWorker(redisUrl, failedJobs, registry)
    : new QueueWorker(redisUrl, failedJobs, registry);
}

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
