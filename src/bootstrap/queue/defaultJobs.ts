import { ExportAuditLogsJob } from "@getstrata/core/jobs/exportAuditLogsJob";
import { InvalidateCacheTagsJob } from "@getstrata/core/jobs/invalidateCacheTagsJob";
import type { JobRegistry } from "@getstrata/core/queue/jobRegistry";

function registerDefaultJobs(registry: JobRegistry): void {
  registry.register("cache.invalidate-tags", () => {
    return new InvalidateCacheTagsJob();
  });
  registry.register("audit.export", () => new ExportAuditLogsJob());
}

export { registerDefaultJobs };
