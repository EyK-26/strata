import { describe, expect, test } from "bun:test";
import { runInteractiveShell } from "@getstrata/core/terminal/runShell";

describe("runInteractiveShell", () => {
  test("runs a short-lived command to completion", async () => {
    const exitCode = await runInteractiveShell(["sh", "-c", "exit 0"]);
    expect(exitCode).toBe(0);
  });
});
