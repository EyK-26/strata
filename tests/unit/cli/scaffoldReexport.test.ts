import { describe, expect, test } from "bun:test";

describe("monorepo CLI scaffold re-exports", () => {
  test("make commands resolve to @getstrata/cli/scaffold implementations", async () => {
    const [{ makeJobCommand: monorepoJob }, { makeJobCommand: packageJob }] = await Promise.all([
      import("../../../src/cli/commands/makeJob.ts"),
      import("@getstrata/cli/scaffold/makeJob"),
    ]);

    expect(monorepoJob).toBe(packageJob);
  });
});
