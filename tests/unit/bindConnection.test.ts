import { describe, expect, test } from "bun:test";
import type { DatabaseConnection } from "@getstrata/core/database/baseRepository";
import {
  bindDatabaseConnection,
  getBoundDatabaseConnection,
  resetBoundDatabaseConnection,
} from "@getstrata/core/database/bindConnection";
import { resolveRepositoryConnection } from "@getstrata/core/database/repositoryConnection";

describe("bindDatabaseConnection", () => {
  test("routes repository queries through the bound connection", async () => {
    const calls: string[] = [];
    const bound: DatabaseConnection = {
      async unsafe<T>(query: string) {
        calls.push(query);
        return [] as T[];
      },
    };

    bindDatabaseConnection(bound);
    expect(getBoundDatabaseConnection()).toBe(bound);
    await resolveRepositoryConnection().unsafe("SELECT 1");

    expect(calls).toEqual(["SELECT 1"]);
    resetBoundDatabaseConnection();
  });

  test("resetBoundDatabaseConnection clears the override", () => {
    bindDatabaseConnection({
      async unsafe() {
        return [];
      },
    });
    resetBoundDatabaseConnection();
    expect(getBoundDatabaseConnection()).toBeNull();
    expect(resolveRepositoryConnection()).not.toBeNull();
  });
});
