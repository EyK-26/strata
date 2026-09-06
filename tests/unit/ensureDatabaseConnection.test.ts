import { describe, expect, test } from "bun:test";
import { restoreDefaultDatabaseConnection } from "./testHelpers";

describe("ensureDatabaseConnection", () => {
  test("recreates the connection when ping fails", async () => {
    const module = await import("../../src/db/connection");

    const failingConnection = Object.assign(
      async () => {
        throw new Error("connection down");
      },
      {
        unsafe: async () => {
          throw new Error("connection down");
        },
        close: async () => undefined,
      },
    ) as never;

    module.resetDatabaseConnectionForTests(failingConnection);

    try {
      const connection = await module.ensureDatabaseConnection();

      expect(connection).toBeDefined();
      expect(connection).not.toBe(failingConnection);
      expect(await module.pingDatabase(connection)).toBe(true);
    } finally {
      await restoreDefaultDatabaseConnection();
    }
  });

  test("db proxy re-registers the fixture pool after another test reset the default", async () => {
    const module = await import("../../src/db/connection");
    const { getDefaultDatabasePool, resetDefaultDatabasePoolForTests } = await import(
      "../../src/core/database/defaultConnection"
    );

    const held = module.getDatabase();
    resetDefaultDatabasePoolForTests();
    expect(() => getDefaultDatabasePool()).toThrow("Default database pool is not registered");

    try {
      // Touching the proxy must not depend on which test file ran before.
      expect(await module.pingDatabase(module.default)).toBe(true);
      expect(getDefaultDatabasePool()).toBe(held as never);
    } finally {
      await restoreDefaultDatabaseConnection();
    }
  });
});
