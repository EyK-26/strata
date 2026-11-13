import { describe, expect, test } from "bun:test";
import { databaseConfig } from "../../src/config/database";
import { FixtureDatabase, fixtureDatabase } from "../helpers/fixtureDatabase";
import { createMockDatabaseConnection } from "./testHelpers";

describe("databaseConfig", () => {
  test("reads pool settings from environment variables", () => {
    expect(databaseConfig.poolMax).toBeGreaterThanOrEqual(1);
    expect(databaseConfig.idleTimeoutSeconds).toBeGreaterThanOrEqual(0);
    expect(databaseConfig.maxLifetimeSeconds).toBeGreaterThanOrEqual(0);
    expect(databaseConfig.connectionTimeoutSeconds).toBeGreaterThanOrEqual(1);
  });
});

describe("createDatabaseConnection", () => {
  test("throws when DATABASE_URL is missing", async () => {
    const { createDatabaseConnection } = await import("../../src/db/connection/createConnection");

    expect(() =>
      createDatabaseConnection({
        url: "",
        poolMax: 10,
        idleTimeoutSeconds: 30,
        maxLifetimeSeconds: 3600,
        connectionTimeoutSeconds: 10,
      }),
    ).toThrow("DATABASE_URL is not configured");
  });
});

describe("pingDatabase", () => {
  test("returns true for a healthy database", async () => {
    expect(await fixtureDatabase.ping()).toBe(true);
  });

  test("returns false when the query fails", async () => {
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

    await expect(fixtureDatabase.ping(failingConnection)).resolves.toBe(false);
  });
});

describe("private fixture connection", () => {
  test("retains an explicitly selected tagged connection", async () => {
    const calls: unknown[][] = [];
    const connection = createMockDatabaseConnection(async (...args: unknown[]) => {
      calls.push(args);
      return [{ ok: true }];
    });

    const owner = new FixtureDatabase(() => connection);

    try {
      const result = await owner.connection()`SELECT ${1}`;
      expect(result).toEqual([{ ok: true }]);
      expect(calls.length).toBe(1);
    } finally {
      await owner.close();
    }
  });
});
