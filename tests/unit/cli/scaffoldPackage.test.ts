import { afterEach, describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { scaffoldCommands } from "../../../packages/strata-cli/src/scaffold/index.ts";
import { repoRoot } from "./helpers";

const tempDirectories: string[] = [];

afterEach(async () => {
  process.chdir(repoRoot);
  while (tempDirectories.length > 0) {
    const directory = tempDirectories.pop();
    if (directory) {
      await rm(directory, { recursive: true, force: true });
    }
  }
});

describe("@getstrata/cli/scaffold", () => {
  test("exports make and queue maintenance command loaders", () => {
    expect(typeof scaffoldCommands["make:module"]).toBe("function");
    expect(typeof scaffoldCommands["make:job"]).toBe("function");
    expect(typeof scaffoldCommands["queue:failed"]).toBe("function");
    expect(scaffoldCommands["queue:work"]).toBeUndefined();
  });

  test("make:job writes src/jobs from the package copy", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "strata-cli-scaffold-pkg-"));
    tempDirectories.push(workspace);
    const previousCwd = process.cwd();

    try {
      process.chdir(workspace);
      const loadMakeJob = scaffoldCommands["make:job"];
      if (!loadMakeJob) {
        throw new Error("expected make:job loader");
      }
      const makeJob = await loadMakeJob();
      await makeJob("archive-order");

      expect(existsSync(join(workspace, "src/jobs/archive-orderJob.ts"))).toBe(true);
    } finally {
      process.chdir(previousCwd);
    }
  });
});
