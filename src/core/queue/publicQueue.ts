import FailedJobRepository from "./failedJobRepository.ts";
import FailedJobService from "./failedJobService.ts";
import type { Job, Queue } from "./index.ts";
import { jobRegistry } from "./jobRegistry.ts";
import { runQueueJob } from "./jobRunner.ts";
import { QueueWorker, RedisQueue } from "./redisQueue.ts";
import { ResilientQueue } from "./resilientQueue.ts";

function createFailedJobService(): FailedJobService {
  return new FailedJobService(new FailedJobRepository());
}

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
    failedJobs?: FailedJobService;
    registerJobs?: () => void;
  } = {},
): Queue {
  options.registerJobs?.();

  const failedJobs = options.failedJobs ?? createFailedJobService();

  if (driver === "redis") {
    if (!options.redisUrl) {
      throw new Error('QUEUE_DRIVER="redis" requires REDIS_URL to be set.');
    }

    return new RedisQueue(options.redisUrl);
  }

  return new ResilientQueue(failedJobs, driver === "async");
}

function createQueueWorker(
  redisUrl: string,
  failedJobs: FailedJobService = createFailedJobService(),
): QueueWorker {
  return new QueueWorker(redisUrl, failedJobs);
}

export {
  createFailedJobService,
  createProductionQueue,
  createQueueWorker,
  createTrackedJob,
  FailedJobRepository,
  FailedJobService,
  jobRegistry,
  QueueWorker,
  RedisQueue,
  ResilientQueue,
  runQueueJob,
};
