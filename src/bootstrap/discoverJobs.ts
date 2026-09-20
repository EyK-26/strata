import { existsSync, readdirSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import type { Job } from "@getstrata/core/queue";
import { jobRegistry } from "@getstrata/core/queue/jobRegistry";

type DiscoveredJobClass = (new () => Job) & { jobName?: string };

const requireJob = createRequire(import.meta.url);

const DISCOVER_JOBS_STATE_KEY = Symbol.for("@getstrata/discoverJobsState");

interface DiscoverJobsState {
  names?: string[];
}

function readDiscoverJobsState(): DiscoverJobsState {
  const existing = (globalThis as Record<symbol, DiscoverJobsState | undefined>)[
    DISCOVER_JOBS_STATE_KEY
  ];

  if (existing) {
    return existing;
  }

  const state: DiscoverJobsState = {};
  (globalThis as Record<symbol, DiscoverJobsState>)[DISCOVER_JOBS_STATE_KEY] = state;
  return state;
}

function resolveJobsDirectory(): string {
  const fromCwd = join(process.cwd(), "src", "jobs");

  if (existsSync(fromCwd)) {
    return fromCwd;
  }

  return join(import.meta.dir, "../jobs");
}

function loadDiscoveredJobClasses(): DiscoveredJobClass[] {
  const jobsDirectory = resolveJobsDirectory();

  let entries: string[];

  try {
    entries = readdirSync(jobsDirectory, { withFileTypes: true })
      .filter((entry) => entry.isFile() && /\.(ts|js)$/.test(entry.name))
      .map((entry) => entry.name);
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return [];
    }

    throw error;
  }

  return entries.flatMap((fileName) => {
    const filePath = join(jobsDirectory, fileName);
    const loaded = requireJob(filePath) as { default?: DiscoveredJobClass };
    const JobClass = loaded.default;

    if (typeof JobClass !== "function" || typeof JobClass.jobName !== "string") {
      return [];
    }

    if (JobClass.jobName.length === 0) {
      return [];
    }

    return [JobClass];
  });
}

function discoverJobs(): string[] {
  const state = readDiscoverJobsState();

  if (state.names) {
    return state.names;
  }

  const names: string[] = [];

  for (const JobClass of loadDiscoveredJobClasses()) {
    const jobName = JobClass.jobName;
    if (!jobName) {
      continue;
    }

    jobRegistry.register(jobName, () => new JobClass());
    names.push(jobName);
  }

  state.names = names;
  return names;
}

function resetDiscoverJobsForTests(): void {
  const state = readDiscoverJobsState();
  state.names = undefined;
}

export type { DiscoveredJobClass };
export { discoverJobs, resetDiscoverJobsForTests };
