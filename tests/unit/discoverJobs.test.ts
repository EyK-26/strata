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

async function writeJob(directory: string, fileName: string, source: string): Promise<void> {
  await writeFile(join(directory, fileName), source);
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

    expect(await discoverJobs()).toEqual([]);
  });

  test("returns no names when cwd src/jobs exists but is empty", async () => {
    const root = await tempDir();
    await mkdir(join(root, "src", "jobs"), { recursive: true });

    process.chdir(root);
    const { discoverJobs, resetDiscoverJobsForTests } = await import(
      "../../src/bootstrap/discoverJobs"
    );
    resetDiscoverJobsForTests();

    expect(await discoverJobs()).toEqual([]);
  });

  test("registers jobs with static jobName from cwd", async () => {
    const root = await tempDir();
    const jobsDirectory = join(root, "src", "jobs");
    await mkdir(jobsDirectory, { recursive: true });
    await writeJob(
      jobsDirectory,
      "echoJob.ts",
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

    expect(await discoverJobs()).toEqual(["echo"]);
    expect(jobRegistry.create("echo")?.constructor.name).toBe("EchoJob");
  });

  test("loads legacy CommonJS defaults and ignores explicitly excluded helper modules", async () => {
    const root = await tempDir();
    const jobsDirectory = join(root, "src", "jobs");
    await mkdir(jobsDirectory, { recursive: true });
    await writeJob(jobsDirectory, "helper.ts", "export default 1;");
    await writeJob(
      jobsDirectory,
      "fromJs.js",
      'module.exports = {default: class FromJs {static jobName="from-js"; async handle(){}}};',
    );
    process.chdir(root);
    const { discoverJobs } = await import("../../src/bootstrap/discoverJobs");
    expect(await discoverJobs({ exclude: ["helper.ts"] })).toEqual(["from-js"]);
    expect(jobRegistry.create("from-js")?.constructor.name).toBe("FromJs");
  });

  test("returns cached names until reset", async () => {
    const root = await tempDir();
    const jobsDirectory = join(root, "src", "jobs");
    await mkdir(jobsDirectory, { recursive: true });
    await writeJob(
      jobsDirectory,
      "echoJob.ts",
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

    expect(await discoverJobs()).toEqual(["echo"]);

    await writeJob(
      jobsDirectory,
      "laterJob.ts",
      `export default class LaterJob {
  static jobName = "later";
  async handle() {}
}
`,
    );

    expect(await discoverJobs()).toEqual(["echo"]);

    resetDiscoverJobsForTests();
    expect((await discoverJobs()).toSorted()).toEqual(["echo", "later"]);
  });

  test("rethrows non-ENOENT errors when src/jobs is not a directory", async () => {
    const root = await tempDir();
    await mkdir(join(root, "src"), { recursive: true });
    await writeFile(join(root, "src", "jobs"), "not a directory\n");

    process.chdir(root);
    const { discoverJobs, resetDiscoverJobsForTests } = await import(
      "../../src/bootstrap/discoverJobs"
    );
    resetDiscoverJobsForTests();

    await expect(discoverJobs()).rejects.toThrow();
  });
});
