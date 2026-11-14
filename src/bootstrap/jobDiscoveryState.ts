import type { JobRegistry } from "@getstrata/core/queue/jobRegistry";
import type { JobManifestEntry } from "./discoverJobs";

/** Package-private registry-owned discovery cache, shared by all package entries. */
interface DiscoverJobsState {
  registered: Map<string, { identity: unknown; location: string }>;
  loads: Map<string | readonly JobManifestEntry[], Promise<string[]>>;
}
const states = new WeakMap<JobRegistry, DiscoverJobsState>();
function jobDiscoveryState(registry: JobRegistry): DiscoverJobsState {
  let value = states.get(registry);
  if (!value) {
    value = { loads: new Map(), registered: new Map() };
    states.set(registry, value);
  }
  return value;
}

export { jobDiscoveryState };
