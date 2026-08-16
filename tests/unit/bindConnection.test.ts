import { describe, expect, test } from "bun:test";
import type { DatabaseConnection } from "@getstrata/core/database/baseRepository";
import {
  bindDatabaseConnection,
  resetBoundDatabaseConnection,
} from "@getstrata/core/database/boundConnection";
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
    expect(resolveRepositoryConnection()).not.toBeNull();
  });
});
