import type { JobRegistry } from "@getstrata/core/queue/jobRegistry";
import { jobDiscoveryState } from "#strata-job-discovery";

/** Forget discovery caches for this registry between isolated tests. */
function resetDiscoverJobsForTests(registry: JobRegistry): void {
  jobDiscoveryState(registry).loads = new Map();
  jobDiscoveryState(registry).registered = new Map();
}

export { resetDiscoverJobsForTests };
