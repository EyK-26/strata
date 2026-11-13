import { createServiceToken } from "@getstrata/core/contracts/token";
import type { Job } from "./index";

type JobFactory = () => Job;

class JobRegistry {
  private readonly factories = new Map<string, JobFactory>();
  private readonly instances = new WeakMap<Job, string>();

  register(name: string, factory: JobFactory): void {
    this.factories.set(name, factory);
  }

  resolveName(job: Job): string | undefined {
    const tracked = this.instances.get(job);
    if (tracked) return tracked;
    const name = (job.constructor as typeof Job).jobName;
    return name && this.has(name) ? name : undefined;
  }

  track(name: string, job: Job): Job {
    this.instances.set(job, name);
    return job;
  }

  has(name: string): boolean {
    return this.factories.has(name);
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

const QUEUE_JOB_REGISTRY_TOKEN = createServiceToken<JobRegistry>("core.queueJobRegistry");

export { JobRegistry, QUEUE_JOB_REGISTRY_TOKEN };
