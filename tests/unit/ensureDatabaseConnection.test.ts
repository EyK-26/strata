import { describe, expect, mock, test } from "bun:test";
import type { DatabaseConnection } from "@getstrata/core/database";
import { restoreDefaultDatabaseConnection } from "./testHelpers";

describe("ensureDatabaseConnection", () => {
  test("recreates the connection when ping fails", async () => {
    let createdConnections = 0;

    const createConnection = (): DatabaseConnection => {
      createdConnections += 1;
      const id = createdConnections;

      return Object.assign(
        async () => {
          if (id === 1) {
            throw new Error("connection down");
          }

          return [{ ok: true }];
        },
        {
          unsafe: async () => [],
          close: async () => undefined,
        },
      ) as unknown as DatabaseConnection;
    };

    mock.module("../../src/db/connection/createConnection", () => ({
      createDatabaseConnection: () => createConnection(),
    }));

    mock.module("../../src/config/database", () => ({
      databaseConfig: {
        url: "postgres://example",
        poolMax: 1,
        idleTimeoutSeconds: 1,
        maxLifetimeSeconds: 1,
        connectionTimeoutSeconds: 1,
      },
    }));

    try {
      const module = await import("../../src/db/connection");
      module.resetDatabaseConnectionForTests(createConnection() as never);

      await expect(module.ensureDatabaseConnection()).resolves.toBeDefined();
      expect(createdConnections).toBeGreaterThanOrEqual(2);
    } finally {
      mock.restore();
      await restoreDefaultDatabaseConnection();
    }
  });
});
