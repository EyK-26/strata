import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { captureConsole, mockProcessExit } from "./helpers";

describe("cli index unknown entrypoint", () => {
  test("imports index.ts and rejects unknown commands", async () => {
    const originalArgv = process.argv;
    process.argv = [originalArgv[0] ?? "bun", originalArgv[1] ?? "test", "missing-command"];

    const output = captureConsole();
    const exit = mockProcessExit();
    const entrypoint = pathToFileURL(join(import.meta.dir, "../../../src/cli/index.ts")).href;

    try {
      await expect(import(entrypoint)).rejects.toThrow("process.exit");
    } finally {
      output.restore();
      exit.restore();
      process.argv = originalArgv;
    }

    expect(exit.getCode()).toBe(1);
    expect(output.errors[0]).toContain("Unknown command: missing-command");
    expect(output.logs[0]).toContain("Available commands:");
  });
});
