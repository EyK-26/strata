import FailedJobRepository from "@getstrata/core/queue/failedJobRepository";
import FailedJobService from "./failedJobService.ts";
import type { Job, Queue } from "./index.ts";
import { jobRegistry } from "./jobRegistry.ts";
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
  name: string,
  job: Job<TPayload>,
): Job<TPayload> {
  return jobRegistry.track(name, job);
}

function createProductionQueue(
  driver: "sync" | "async" | "redis",
  options: {
    redisUrl?: string;
    failedJobs: QueueServices;
    registerJobs?: () => void;
  },
): Queue {
  options.registerJobs?.();

  const failedJobs = options.failedJobs;

  if (driver === "redis") {
    if (!options.redisUrl) {
      throw new Error('QUEUE_DRIVER="redis" requires REDIS_URL to be set.');
    }

    return resolveRedisQueueTransport() === "streams"
      ? new RedisStreamsQueue(options.redisUrl)
      : new RedisQueue(options.redisUrl);
  }

  return new ResilientQueue(failedJobs, driver === "async");
}

function createQueueWorker(
  redisUrl: string,
  failedJobs: Pick<QueueServices, "recordFailure" | "runAttempt">,
): QueueWorker | RedisStreamsWorker {
  return resolveRedisQueueTransport() === "streams"
    ? new RedisStreamsWorker(redisUrl, failedJobs)
    : new QueueWorker(redisUrl, failedJobs);
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
  jobRegistry,
  QueueWorker,
  RedisQueue,
  ResilientQueue,
  runQueueJob,
};
