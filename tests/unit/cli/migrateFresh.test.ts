import { afterAll, afterEach, describe, expect, mock, spyOn, test } from "bun:test";
import { migrateFreshCommand } from "../../../src/cli/commands/migrateFresh";
import * as migrationRunner from "../../../src/db/migrations/runner";

afterAll(() => {
  mock.restore();
});

describe("migrateFreshCommand", () => {
  const previousSchema = process.env.STRATA_SCHEMA;

  afterEach(() => {
    if (previousSchema === undefined) {
      delete process.env.STRATA_SCHEMA;
    } else {
      process.env.STRATA_SCHEMA = previousSchema;
    }
  });

  test("calls freshDatabase without seed by default", async () => {
    process.env.STRATA_SCHEMA = "fixture";
    const freshDatabase = spyOn(migrationRunner, "freshDatabase").mockResolvedValue(undefined);

    await migrateFreshCommand();

    expect(freshDatabase).toHaveBeenCalledWith({ seed: false });
    freshDatabase.mockRestore();
  });

  test("passes seed option when --seed is provided", async () => {
    process.env.STRATA_SCHEMA = "fixture";
    const freshDatabase = spyOn(migrationRunner, "freshDatabase").mockResolvedValue(undefined);

    await migrateFreshCommand("--seed");

    expect(freshDatabase).toHaveBeenCalledWith({ seed: true });
    freshDatabase.mockRestore();
  });

  test("rejects unknown arguments", async () => {
    const freshDatabase = spyOn(migrationRunner, "freshDatabase").mockResolvedValue(undefined);

    await expect(migrateFreshCommand("--force")).rejects.toThrow(
      "Unknown arguments for migrate:fresh: --force. Supported: --seed",
    );
    expect(freshDatabase).not.toHaveBeenCalled();
    freshDatabase.mockRestore();
  });
});
