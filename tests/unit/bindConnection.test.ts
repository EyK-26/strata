import { afterEach, describe, expect, test } from "bun:test";
import type { DatabaseConnection } from "@getstrata/core/database/baseRepository";
import {
  bindDatabaseConnection,
  getBoundDatabaseConnection,
  resetBoundDatabaseConnection,
} from "@getstrata/core/database/bindConnection";
import { resetSqlDialect, useSqlDialect } from "@getstrata/core/database/dialect";
import {
  repositoryConnection as db,
  resolveRepositoryConnection,
} from "@getstrata/core/database/repositoryConnection";

describe("bindDatabaseConnection", () => {
  afterEach(() => {
    resetBoundDatabaseConnection();
    resetSqlDialect();
  });

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

  test("stores the bound connection on a process-wide globalThis key", () => {
    const bound: DatabaseConnection = {
      async unsafe() {
        return [];
      },
    };
    bindDatabaseConnection(bound);
    const holder = (globalThis as Record<symbol, { connection: DatabaseConnection | null }>)[
      Symbol.for("@getstrata/boundDatabaseConnection")
    ];
    expect(holder?.connection).toBe(bound);
    resetBoundDatabaseConnection();
  });

  test("compiles tagged SQL onto an unsafe-only sqlite connection", async () => {
    const calls: Array<{ query: string; params: readonly unknown[] | undefined }> = [];
    bindDatabaseConnection({
      async unsafe<T>(query: string, params?: readonly unknown[]) {
        calls.push({ query, params });
        return [{ id: 1 }] as T[];
      },
    });
    useSqlDialect("sqlite");

    const rows = (await db`SELECT id FROM tenant WHERE id = ${7}`) as Array<{ id: number }>;

    expect(rows).toEqual([{ id: 1 }]);
    expect(calls).toEqual([{ query: "SELECT id FROM tenant WHERE id = ?", params: [7] }]);
  });

  test("rejects a bound connection that cannot run SQL", () => {
    bindDatabaseConnection({} as DatabaseConnection);
    expect(() => {
      void db`SELECT 1`;
    }).toThrow("cannot run SQL");
  });
});
