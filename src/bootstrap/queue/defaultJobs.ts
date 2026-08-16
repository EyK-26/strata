import DispatchWebhookJob from "../../core/jobs/dispatchWebhookJob";
import InvalidateCacheTagsJob from "../../core/jobs/invalidateCacheTagsJob";
import { jobRegistry } from "../../core/queue/jobRegistry";
import { resolveApplicationCache } from "../applicationRegistry";

function registerDefaultJobs(): void {
  jobRegistry.register("cache.invalidate-tags", () => {
    return new InvalidateCacheTagsJob(resolveApplicationCache());
  });
  jobRegistry.register("webhook.dispatch", () => new DispatchWebhookJob());
}

export { registerDefaultJobs };
