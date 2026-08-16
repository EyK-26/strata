import { describe, expect, test } from "bun:test";
import { Job } from "@getstrata/core/queue";
import { JobRegistry, jobRegistry } from "@getstrata/core/queue/jobRegistry";

class SampleJob extends Job<{ marker: string }> {
  override async handle(): Promise<void> {
    // no-op
  }
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

  test("uses the shared job registry singleton", () => {
    const job = new SampleJob();

    jobRegistry.register("singleton.test", () => new SampleJob());
    expect(jobRegistry.create("singleton.test")).toBeInstanceOf(SampleJob);
    expect(jobRegistry.track("tracked.singleton", job)).toBe(job);
    expect(jobRegistry.resolveName(job)).toBe("tracked.singleton");
    expect(jobRegistry.names()).toContain("singleton.test");
  });
});
