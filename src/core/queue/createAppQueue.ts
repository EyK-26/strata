import { resolveApplicationCache } from "../../bootstrap/applicationRegistry";
import InvalidateCacheTagsJob from "../jobs/invalidateCacheTagsJob";
import { jobRegistry } from "./jobRegistry";
import { createQueue, Job, type Queue } from "./index";
import { RedisQueue } from "./redisQueue";

function registerDefaultJobs(): void {
  jobRegistry.register("cache.invalidate-tags", () => {
    return new InvalidateCacheTagsJob(resolveApplicationCache());
  });
}

function createTrackedJob<TPayload extends object>(
  name: string,
  job: Job<TPayload>,
): Job<TPayload> {
  return jobRegistry.track(name, job);
}

function createAppQueue(driver: "sync" | "async" | "redis", redisUrl?: string): Queue {
  registerDefaultJobs();

  if (driver === "redis") {
    if (!redisUrl) {
      throw new Error('QUEUE_DRIVER="redis" requires REDIS_URL to be set.');
    }

    return new RedisQueue(redisUrl);
  }

  return createQueue(driver === "async" ? "async" : "sync");
}

export { createAppQueue, createTrackedJob, registerDefaultJobs };
