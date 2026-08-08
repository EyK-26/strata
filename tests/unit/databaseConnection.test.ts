import { describe, expect, test } from "bun:test";
import { databaseConfig } from "../../src/config/database";

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
    const { pingDatabase } = await import("../../src/db/connection");

    expect(await pingDatabase()).toBe(true);
  });
});
