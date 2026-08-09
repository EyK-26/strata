import { describe, expect, test } from "bun:test";
import { helpCommand } from "../../../src/cli/commands/help";
import { captureConsole } from "./helpers";

describe("helpCommand", () => {
  test("prints available CLI commands", () => {
    const output = captureConsole();

    try {
      helpCommand();
    } finally {
      output.restore();
    }

    expect(output.logs).toHaveLength(1);
    expect(output.logs[0]).toContain("Available commands:");
    expect(output.logs[0]).toContain("dev");
    expect(output.logs[0]).toContain("start");
    expect(output.logs[0]).toContain("run <file>");
    expect(output.logs[0]).toContain("route:list");
    expect(output.logs[0]).toContain("openapi:check");
    expect(output.logs[0]).toContain("migrate:status");
  });
});
