import { describe, expect, test } from "bun:test";
import { migrateStatusCommand } from "../../../src/cli/commands/migrateStatus";
import { captureConsole } from "./helpers";

describe("migrateStatusCommand", () => {
  test("prints migration status entries", async () => {
    const output = captureConsole();

    try {
      await migrateStatusCommand();
    } finally {
      output.restore();
    }

    expect(output.logs.length).toBeGreaterThan(0);
    expect(output.logs[0]).toBe("Migration status:");
    expect(output.logs.some((line) => line.includes("[up]") || line.includes("[pending]"))).toBe(
      true,
    );
  });
});
