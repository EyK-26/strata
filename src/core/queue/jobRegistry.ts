import type { Job } from "./index";

type JobFactory = () => Job;

class JobRegistry {
  private readonly factories = new Map<string, JobFactory>();
  private readonly instances = new WeakMap<Job, string>();

  register(name: string, factory: JobFactory): void {
    this.factories.set(name, factory);
  }

  resolveName(job: Job): string | undefined {
    return this.instances.get(job);
  }

  track(name: string, job: Job): Job {
    this.instances.set(job, name);
    return job;
  }

  create(name: string): Job | undefined {
    const factory = this.factories.get(name);

    if (!factory) {
      return undefined;
    }

    return factory();
  }

  names(): string[] {
    return [...this.factories.keys()];
  }
}

const JOB_REGISTRY_KEY = Symbol.for("@getstrata/jobRegistry");

function readSharedJobRegistry(): JobRegistry {
  const globalRegistry = (globalThis as Record<symbol, JobRegistry | undefined>)[JOB_REGISTRY_KEY];

  if (globalRegistry) {
    return globalRegistry;
  }

  const registry = new JobRegistry();
  (globalThis as Record<symbol, JobRegistry>)[JOB_REGISTRY_KEY] = registry;
  return registry;
}

const jobRegistry = readSharedJobRegistry();

export { JobRegistry, jobRegistry };
