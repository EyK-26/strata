import { describe, expect, test } from "bun:test";
import { printHelp } from "../../../packages/strata-cli/src/commands/help";
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

describe("published CLI worker discovery", () => {
  test("explains registered workers without starting or loading them", () => {
    const output = captureConsole();
    try {
      printHelp(["dev", "start", "queue:work", "outbox:work", "queue:work"]);
      expect(output.logs).toHaveLength(1);
      const help = output.logs.join("\n");
      expect(help).toContain("Poll Redis for queued jobs; requires REDIS_URL");
      expect(help).toContain("Poll SQL for durable listener deliveries");
      expect(help).toContain("dev/start do not start workers");
      expect(help).toContain("same application configuration");
      expect(help).toContain("not a dependency health check");
      expect(help.match(/^- queue:work/gm)).toHaveLength(1);
    } finally {
      output.restore();
    }
  });
  test.each([
    ["dev", "start"],
    ["dev", "queue:work"],
  ])("only mentions available mechanisms: %s %s", (first, second) => {
    const commands = [first, second];
    const output = captureConsole();
    try {
      printHelp(commands);
      expect(output.logs[0]).not.toContain("outbox");
      if (!commands.includes("queue:work")) {
        expect(output.logs[0]).not.toContain("Redis");
        expect(output.logs[0]).not.toContain("Background workers");
      }
    } finally {
      output.restore();
    }
  });
});
