import { afterEach, describe, expect, test } from "bun:test";
import type { SqlDatabaseConnection } from "../../src/core/database/baseRepository";
import {
  getDefaultDatabasePool,
  getDefaultDatabaseQuery,
  registerDefaultDatabasePool,
} from "../../src/core/database/defaultConnection";
import { getDatabase } from "../../src/db/connection";

describe("default database connection registry", () => {
  let restoredPool: SqlDatabaseConnection | null = null;

  afterEach(() => {
    if (restoredPool) {
      registerDefaultDatabasePool(restoredPool);
      restoredPool = null;
      return;
    }

    if (process.env.DATABASE_URL) {
      getDatabase();
    }
  });

  test("registers pool and query handles for framework code", () => {
    restoredPool = getDefaultDatabasePool();

    type TestPool = {
      (strings: TemplateStringsArray, ...values: unknown[]): Promise<unknown[]>;
      begin<T>(callback: (tx: TestPool) => Promise<T>): Promise<T>;
      close(): Promise<void>;
      unsafe<T>(query: string, params?: readonly unknown[]): Promise<T[]>;
    };

    const pool: TestPool = Object.assign(async () => [] as unknown[], {
      async begin<T>(callback: (tx: TestPool) => Promise<T>) {
        return await callback(pool);
      },
      async close() {},
      async unsafe<T>() {
        return [] as T[];
      },
    });

    registerDefaultDatabasePool(pool as SqlDatabaseConnection);

    expect(getDefaultDatabasePool()).toBe(pool);

    const query = getDefaultDatabaseQuery();
    expect(typeof query).toBe("function");
    expect(typeof query.begin).toBe("function");
  });
});
