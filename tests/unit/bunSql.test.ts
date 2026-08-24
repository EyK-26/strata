import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type {
  DatabaseConnection,
  SqlDatabaseConnection,
} from "@getstrata/core/database/baseRepository";
import {
  getBoundDatabaseConnection,
  resetBoundDatabaseConnection,
} from "@getstrata/core/database/boundConnection";
import { bindBunSql, createBunSqlPool } from "@getstrata/core/database/bunSql";
import {
  getDefaultDatabasePool,
  registerDefaultDatabasePool,
} from "@getstrata/core/database/defaultConnection";
import { getDatabase } from "../../src/db/connection";

describe("bun SQL helpers", () => {
  let restoredPool: SqlDatabaseConnection | null = null;

  beforeEach(() => {
    try {
      restoredPool = getDefaultDatabasePool();
    } catch {
      restoredPool = null;
    }
  });

  afterEach(() => {
    resetBoundDatabaseConnection();

    if (restoredPool) {
      registerDefaultDatabasePool(restoredPool);
      restoredPool = null;
      return;
    }

    if (process.env.DATABASE_URL) {
      getDatabase();
    }
  });

  test("bindBunSql registers the client as the bound connection and default pool", async () => {
    const calls: string[] = [];
    const sql: DatabaseConnection = {
      async unsafe<T>(query: string) {
        calls.push(query);
        return [] as T[];
      },
    };

    expect(bindBunSql(sql)).toBe(sql);
    expect(getBoundDatabaseConnection()).toBe(sql);
    expect(getDefaultDatabasePool()).toBe(sql);
    await sql.unsafe("SELECT 1");
    expect(calls).toEqual(["SELECT 1"]);
  });

  test("createBunSqlPool requires a url", () => {
    expect(() => createBunSqlPool({ url: "" })).toThrow("DATABASE_URL is not configured");
  });

  test("createBunSqlPool returns a Bun SQL client", async () => {
    const sql = createBunSqlPool({
      url: "postgres://postgres:postgres@127.0.0.1:1/strata_pool_test",
      max: 2,
      idleTimeout: 5,
      maxLifetime: 30,
      connectionTimeout: 1,
    });

    expect(typeof sql.unsafe).toBe("function");
    await sql.close();
  });

  test("createBunSqlPool uses pool defaults when options are omitted", async () => {
    const sql = createBunSqlPool({
      url: "postgres://postgres:postgres@127.0.0.1:1/strata_pool_defaults",
    });

    expect(typeof sql.unsafe).toBe("function");
    await sql.close();
  });
});
