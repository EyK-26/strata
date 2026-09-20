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

    expect(discoverJobs()).toEqual([]);
  });

  test("returns no names when cwd src/jobs exists but is empty", async () => {
    const root = await tempDir();
    await mkdir(join(root, "src", "jobs"), { recursive: true });

    process.chdir(root);
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

    expect(discoverJobs()).toEqual(["echo"]);
    expect(jobRegistry.create("echo")?.constructor.name).toBe("EchoJob");
  });

  test("skips files that are not jobs and loads .js defaults", async () => {
    const root = await tempDir();
    const jobsDirectory = join(root, "src", "jobs");
    await mkdir(join(jobsDirectory, "nested"), { recursive: true });
    await writeJob(jobsDirectory, "readme.txt", "not a job\n");
    await writeJob(jobsDirectory, "noDefault.ts", "export class NotDefault {}\n");
    await writeJob(jobsDirectory, "notAClass.ts", "export default 1;\n");
    await writeJob(
      jobsDirectory,
      "noName.ts",
      `export default class NoNameJob {
  async handle() {}
}
`,
    );
    await writeJob(
      jobsDirectory,
      "emptyName.ts",
      `export default class EmptyNameJob {
  static jobName = "";
  async handle() {}
}
`,
    );
    await writeJob(
      jobsDirectory,
      "fromJs.js",
      `module.exports = {
  default: class FromJs {
    static jobName = "from-js";
    async handle() {}
  },
};
`,
    );

    process.chdir(root);
    const { discoverJobs, resetDiscoverJobsForTests } = await import(
      "../../src/bootstrap/discoverJobs"
    );
    resetDiscoverJobsForTests();

    expect(discoverJobs()).toEqual(["from-js"]);
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

    expect(discoverJobs()).toEqual(["echo"]);

    await writeJob(
      jobsDirectory,
      "laterJob.ts",
      `export default class LaterJob {
  static jobName = "later";
  async handle() {}
}
`,
    );

    expect(discoverJobs()).toEqual(["echo"]);

    resetDiscoverJobsForTests();
    expect(discoverJobs()).toEqual(["echo", "later"]);
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

    expect(() => discoverJobs()).toThrow();
  });
});
