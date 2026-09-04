import { afterEach, describe, expect, mock, test } from "bun:test";

const previousDogfood = process.env.DOGFOOD_APP;

afterEach(() => {
  mock.restore();
  if (previousDogfood === undefined) {
    delete process.env.DOGFOOD_APP;
  } else {
    process.env.DOGFOOD_APP = previousDogfood;
  }
});

describe("migrateCommand", () => {
  test("delegates to migrateDatabase", async () => {
    process.env.DOGFOOD_APP = "workhub";
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
    process.env.DOGFOOD_APP = "workhub";
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
