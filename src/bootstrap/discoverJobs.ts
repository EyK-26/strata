import { join, resolve } from "node:path";
import { Job } from "@getstrata/core/queue";
import { jobRegistry } from "@getstrata/core/queue/jobRegistry";
import {
  type InfrastructureDiscoveryOptions,
  importInfrastructure,
  infrastructureFiles,
} from "./infrastructureDiscovery";

type DiscoveredJobClass = (new () => Job) & { jobName: string };
type JobManifestEntry = DiscoveredJobClass | { name: string; create: () => Job };
interface DiscoverJobsOptions extends InfrastructureDiscoveryOptions {
  manifest?: readonly JobManifestEntry[];
}
interface DiscoverJobsState {
  registered: Map<string, { identity: unknown; location: string }>;
  loads: Map<string | readonly JobManifestEntry[], Promise<string[]>>;
}
const KEY = Symbol.for("@getstrata/discoverJobsState");
function state(): DiscoverJobsState {
  const globals = globalThis as Record<symbol, DiscoverJobsState | undefined>;
  globals[KEY] ??= { loads: new Map(), registered: new Map() };
  return globals[KEY];
}
function validateClass(value: unknown, location: string): asserts value is DiscoveredJobClass {
  if (
    typeof value !== "function" ||
    typeof (value as DiscoveredJobClass).jobName !== "string" ||
    !(value as DiscoveredJobClass).jobName.trim() ||
    (!(value.prototype instanceof Job) && typeof value.prototype?.handle !== "function")
  )
    throw new TypeError(
      `Invalid job at ${location}: expected a class with nonempty static jobName and handle().`,
    );
}
async function load(options: DiscoverJobsOptions, current: () => boolean): Promise<string[]> {
  const jobs = new Map<string, { identity: unknown; create: () => Job; location: string }>();
  const add = (name: string, identity: unknown, create: () => Job, location: string) => {
    const previous = jobs.get(name);
    if (previous && previous.identity !== identity)
      throw new Error(
        `Duplicate job "${name}" at ${location}; first declared at ${previous.location}.`,
      );
    if (!previous) jobs.set(name, { identity, create, location });
  };
  if (options.manifest) {
    for (const [index, entry] of options.manifest.entries()) {
      const location = `job manifest[${index}]`;
      if (typeof entry === "function") {
        validateClass(entry, location);
        add(entry.jobName, entry, () => new entry(), location);
      } else {
        if (
          !entry ||
          typeof entry.name !== "string" ||
          !entry.name.trim() ||
          typeof entry.create !== "function"
        )
          throw new TypeError(`Invalid job factory at ${location}.`);
        add(entry.name, entry.create, entry.create, location);
      }
    }
  } else {
    for (const file of await infrastructureFiles(
      options.directory ?? join(process.cwd(), "src", "jobs"),
      options.exclude,
    )) {
      const exports = await importInfrastructure(file);
      // Bun's existing CommonJS {default: class} shape remains supported.
      const defaultValue = exports.default;
      const legacy =
        defaultValue && typeof defaultValue === "object" && "default" in defaultValue
          ? defaultValue.default
          : defaultValue;
      if (legacy !== undefined) validateClass(legacy, `${file}:default`);
      let found = false;
      for (const [name, value] of Object.entries({
        ...exports,
        ...(legacy === undefined ? {} : { default: legacy }),
      })) {
        if (name !== "default" && !(typeof value === "function" && "jobName" in value)) continue;
        validateClass(value, `${file}:${name}`);
        found = true;
        add(value.jobName, value, () => new value(), `${file}:${name}`);
      }
      if (!found)
        throw new TypeError(`No job exports at ${file}; exclude helper modules explicitly.`);
    }
  }
  // Validate the complete batch before publishing. Explicit application factories take precedence.
  if (!current()) return [...jobs.keys()];
  const registered = state().registered;
  for (const [name, entry] of jobs) {
    const previous = registered.get(name);
    if (previous && previous.identity !== entry.identity)
      throw new Error(
        `Duplicate discovered job "${name}" at ${entry.location}; first declared at ${previous.location}.`,
      );
  }
  const existing = new Set(jobRegistry.names());
  for (const [name, entry] of jobs) {
    if (!existing.has(name)) {
      jobRegistry.register(name, entry.create);
      registered.set(name, entry);
    }
  }
  return [...jobs.keys()];
}
function discoverJobs(options: DiscoverJobsOptions = {}): Promise<string[]> {
  const cache = state().loads;
  const key =
    options.manifest ??
    JSON.stringify([
      resolve(options.directory ?? join(process.cwd(), "src", "jobs")),
      [...(options.exclude ?? [])].sort(),
    ]);
  const existing = cache.get(key);
  if (existing) return existing;
  const pending = load(options, () => state().loads === cache).catch((error) => {
    if (cache.get(key) === pending) cache.delete(key);
    throw error;
  });
  cache.set(key, pending);
  return pending;
}
function resetDiscoverJobsForTests(): void {
  state().loads = new Map();
  state().registered = new Map();
}

export type { DiscoveredJobClass, DiscoverJobsOptions, JobManifestEntry };
export { discoverJobs, resetDiscoverJobsForTests };
