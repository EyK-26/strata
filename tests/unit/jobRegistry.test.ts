import { describe, expect, test } from "bun:test";
import { Job } from "@getstrata/core/queue";
import { JobRegistry } from "@getstrata/core/queue/jobRegistry";

const jobRegistry = new JobRegistry();

class SampleJob extends Job<{ marker: string }> {
  override async handle(): Promise<void> {}
}

describe("JobRegistry", () => {
  test("registers factories and creates jobs by name", () => {
    const registry = new JobRegistry();
    registry.register("sample.job", () => new SampleJob());

    expect(registry.names()).toEqual(["sample.job"]);
    expect(registry.create("sample.job")).toBeInstanceOf(SampleJob);
    expect(registry.create("missing.job")).toBeUndefined();
  });

  test("tracks resolved names for job instances", () => {
    const registry = new JobRegistry();
    const job = new SampleJob();

    expect(registry.resolveName(job)).toBeUndefined();
    expect(registry.track("sample.job", job)).toBe(job);
    expect(registry.resolveName(job)).toBe("sample.job");
  });

  test("keeps explicitly created registries independent", () => {
    const job = new SampleJob();

    jobRegistry.register("owner.test", () => new SampleJob());
    expect(jobRegistry.create("owner.test")).toBeInstanceOf(SampleJob);
    expect(jobRegistry.track("tracked.owner", job)).toBe(job);
    expect(jobRegistry.resolveName(job)).toBe("tracked.owner");
    expect(jobRegistry.names()).toContain("owner.test");
    expect(new JobRegistry().has("owner.test")).toBe(false);
  });

  test("resolves static jobName only in the registering owner", () => {
    class NamedJob extends Job<{ marker: string }> {
      static override readonly jobName = "named.job";
      override async handle(): Promise<void> {}
    }

    const job = new NamedJob();
    expect(jobRegistry.resolveName(job)).toBeUndefined();
    jobRegistry.register("named.job", () => new NamedJob());
    expect(jobRegistry.resolveName(job)).toBe("named.job");
    expect(new JobRegistry().resolveName(job)).toBeUndefined();
  });
});
