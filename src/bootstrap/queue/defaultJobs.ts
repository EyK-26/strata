import { ExportAuditLogsJob } from "@getstrata/core/jobs/exportAuditLogsJob";
import { InvalidateCacheTagsJob } from "@getstrata/core/jobs/invalidateCacheTagsJob";
import { jobRegistry } from "@getstrata/core/queue/jobRegistry";

function registerDefaultJobs(): void {
  jobRegistry.register("cache.invalidate-tags", () => {
    return new InvalidateCacheTagsJob();
  });
  jobRegistry.register("audit.export", () => new ExportAuditLogsJob());
}

export { registerDefaultJobs };
