import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { jobRegistry } from "@getstrata/core/queue/jobRegistry";

const repoRoot = join(import.meta.dir, "../..");
const tempDirectories: string[] = [];

async function tempDir(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "strata-discover-jobs-"));
  tempDirectories.push(directory);
  return directory;
}

describe("discoverJobs", () => {
  afterEach(async () => {
    process.chdir(repoRoot);
    const { resetDiscoverJobsForTests } = await import("../../src/bootstrap/discoverJobs");
    resetDiscoverJobsForTests();
    while (tempDirectories.length > 0) {
      const directory = tempDirectories.pop();
      if (directory) {
        await rm(directory, { recursive: true, force: true });
      }
    }
  });

  test("returns no names when src/jobs is absent", async () => {
    const { discoverJobs, resetDiscoverJobsForTests } = await import(
      "../../src/bootstrap/discoverJobs"
    );
    resetDiscoverJobsForTests();

    expect(discoverJobs()).toEqual([]);
  });

  test("registers jobs with static jobName from cwd", async () => {
    const root = await tempDir();
    const jobsDirectory = join(root, "src", "jobs");
    await mkdir(jobsDirectory, { recursive: true });
    await writeFile(
      join(jobsDirectory, "echoJob.ts"),
      `export default class EchoJob {
  static jobName = "echo";
  async handle() {}
}
`,
    );

    process.chdir(root);
    const { discoverJobs, resetDiscoverJobsForTests } = await import(
      "../../src/bootstrap/discoverJobs"
    );
    resetDiscoverJobsForTests();

    expect(discoverJobs()).toEqual(["echo"]);
    expect(jobRegistry.create("echo")?.constructor.name).toBe("EchoJob");
  });
});
