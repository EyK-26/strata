import { resolveApplicationCache } from "../../bootstrap/applicationRegistry";
import InvalidateCacheTagsJob from "../jobs/invalidateCacheTagsJob";
import FailedJobRepository from "./failedJobRepository";
import FailedJobService from "./failedJobService";
import { jobRegistry } from "./jobRegistry";
import { Job, type Queue } from "./index";
import { RedisQueue, QueueWorker } from "./redisQueue";
import { ResilientQueue } from "./resilientQueue";

const FAILED_JOB_SERVICE_TOKEN = "core.failedJobs";

function registerDefaultJobs(): void {
  jobRegistry.register("cache.invalidate-tags", () => {
    return new InvalidateCacheTagsJob(resolveApplicationCache());
  });
}

function createFailedJobService(): FailedJobService {
  return new FailedJobService(new FailedJobRepository());
}

function createTrackedJob<TPayload extends object>(
  name: string,
  job: Job<TPayload>,
): Job<TPayload> {
  return jobRegistry.track(name, job);
}

function createAppQueue(
  driver: "sync" | "async" | "redis",
  redisUrl?: string,
  failedJobs: FailedJobService = createFailedJobService(),
): Queue {
  registerDefaultJobs();

  if (driver === "redis") {
    if (!redisUrl) {
      throw new Error('QUEUE_DRIVER="redis" requires REDIS_URL to be set.');
    }

    return new RedisQueue(redisUrl);
  }

  return new ResilientQueue(failedJobs, driver === "async");
}

function createQueueWorker(redisUrl: string, failedJobs?: FailedJobService): QueueWorker {
  return new QueueWorker(redisUrl, failedJobs ?? createFailedJobService());
}

export {
  createAppQueue,
  createFailedJobService,
  createQueueWorker,
  createTrackedJob,
  FAILED_JOB_SERVICE_TOKEN,
  registerDefaultJobs,
};
