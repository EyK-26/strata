import { afterEach, describe, expect, mock, test } from "bun:test";

const previousSchema = process.env.STRATA_SCHEMA;

afterEach(() => {
  mock.restore();
  if (previousSchema === undefined) {
    delete process.env.STRATA_SCHEMA;
  } else {
    process.env.STRATA_SCHEMA = previousSchema;
  }
});

describe("migrateCommand", () => {
  test("delegates to migrateDatabase", async () => {
    process.env.STRATA_SCHEMA = "fixture";
    let called = false;

    mock.module("../../../src/db/migrations/runner", () => ({
      migrateDatabase: async () => {
        called = true;
      },
    }));

    const { migrateCommand } = await import("../../../src/cli/commands/migrate");
    await migrateCommand();

    expect(called).toBe(true);
  });
});

describe("rollbackCommand", () => {
  test("delegates to rollbackDatabase", async () => {
    process.env.STRATA_SCHEMA = "fixture";
    let called = false;

    mock.module("../../../src/db/migrations/runner", () => ({
      rollbackDatabase: async () => {
        called = true;
      },
    }));

    const { rollbackCommand } = await import("../../../src/cli/commands/rollback");
    await rollbackCommand();

    expect(called).toBe(true);
  });
});

describe("seedCommand", () => {
  test("delegates to seedDatabase", async () => {
    process.env.STRATA_SCHEMA = "fixture";
    let called = false;

    mock.module("../../../src/db/seeders/runner", () => ({
      seedDatabase: async () => {
        called = true;
      },
    }));

    const { seedCommand } = await import("../../../src/cli/commands/seed");
    await seedCommand();

    expect(called).toBe(true);
  });
});
