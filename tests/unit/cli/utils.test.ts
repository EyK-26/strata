import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { migrationDirectory, moduleDirectory } from "@getstrata/cli/scaffold/utils";
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

describe("scaffold utils paths", () => {
  test("moduleDirectory and migrationDirectory resolve from process.cwd()", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "strata-cli-utils-"));
    tempDirectories.push(workspace);
    const previousCwd = process.cwd();
    process.chdir(workspace);

    try {
      expect(moduleDirectory("Billing Widget")).toBe(
        join(process.cwd(), "src", "modules", "billing-widget"),
      );
      expect(migrationDirectory()).toBe(join(process.cwd(), "src", "db", "migrations"));
    } finally {
      process.chdir(previousCwd);
    }
  });
});
