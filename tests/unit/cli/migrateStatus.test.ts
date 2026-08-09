import { afterEach, describe, expect, test } from "bun:test";
import { migrateStatusCommand } from "../../../src/cli/commands/migrateStatus";
import { restoreEnvVar } from "../../helpers/restoreEnv";
import { captureConsole } from "./helpers";

describe("migrateStatusCommand", () => {
  const previousSchema = process.env.STRATA_SCHEMA;

  afterEach(() => {
    restoreEnvVar("STRATA_SCHEMA", previousSchema);
  });

  test("prints migration status entries", async () => {
    process.env.STRATA_SCHEMA = "fixture";
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
