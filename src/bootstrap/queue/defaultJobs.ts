import { ExportAuditLogsJob } from "@getstrata/core/jobs/exportAuditLogsJob";
import { InvalidateCacheTagsJob } from "@getstrata/core/jobs/invalidateCacheTagsJob";
import type { JobRegistry } from "@getstrata/core/queue/jobRegistry";

function registerDefaultJobs(registry: JobRegistry): void {
  registry.register(InvalidateCacheTagsJob.jobName, () => {
    return new InvalidateCacheTagsJob();
  });
  registry.register(ExportAuditLogsJob.jobName, () => new ExportAuditLogsJob());
}

export { registerDefaultJobs };
