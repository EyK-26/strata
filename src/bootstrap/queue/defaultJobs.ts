import { DispatchWebhookJob } from "@getstrata/core/jobs/dispatchWebhookJob";
import { ExportAuditLogsJob } from "@getstrata/core/jobs/exportAuditLogsJob";
import { InvalidateCacheTagsJob } from "@getstrata/core/jobs/invalidateCacheTagsJob";
import { jobRegistry } from "@getstrata/core/queue/jobRegistry";
import { resolveApplicationCache } from "@getstrata/core/runtime/applicationRegistry";

function registerDefaultJobs(): void {
  jobRegistry.register("cache.invalidate-tags", () => {
    return new InvalidateCacheTagsJob(resolveApplicationCache());
  });
  jobRegistry.register("webhook.dispatch", () => new DispatchWebhookJob());
  jobRegistry.register("audit.export", () => new ExportAuditLogsJob());
}

export { registerDefaultJobs };
