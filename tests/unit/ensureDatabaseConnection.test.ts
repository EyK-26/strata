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
});
