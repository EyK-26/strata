import { afterEach, describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import type { SqlDatabaseConnection } from "@getstrata/core/database/baseRepository";
import {
  getDefaultDatabasePool,
  getDefaultDatabaseQuery,
  registerDefaultDatabasePool,
} from "@getstrata/core/database/defaultConnection";
import { getDatabase } from "../../src/db/connection";

const DEFAULT_CONNECTION_KEY = Symbol.for("@getstrata/defaultDatabaseConnection");

function fakePool(): SqlDatabaseConnection {
  const pool = Object.assign(async () => [] as unknown[], {
    async begin<T>(callback: (tx: typeof pool) => Promise<T>) {
      return await callback(pool);
    },
    async close() {},
    async unsafe<T>() {
      return [] as T[];
    },
  });
  return pool as SqlDatabaseConnection;
}

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

  test("stores the pool on a process-wide globalThis key", () => {
    restoredPool = getDefaultDatabasePool();
    const pool = fakePool();
    registerDefaultDatabasePool(pool);

    const holder = (globalThis as Record<symbol, { pool: SqlDatabaseConnection | null }>)[
      DEFAULT_CONNECTION_KEY
    ];
    expect(holder?.pool).toBe(pool);
  });

  test("published bundle and source module share the default pool", async () => {
    const distPath = join(import.meta.dir, "../../packages/strata-core/dist/index.js");
    if (!existsSync(distPath)) {
      return;
    }

    restoredPool = getDefaultDatabasePool();
    const dist = (await import(pathToFileURL(distPath).href)) as {
      registerDefaultDatabasePool: typeof registerDefaultDatabasePool;
      getDefaultDatabasePool: typeof getDefaultDatabasePool;
    };

    const pool = fakePool();
    dist.registerDefaultDatabasePool(pool);
    expect(getDefaultDatabasePool()).toBe(pool);
    expect(dist.getDefaultDatabasePool()).toBe(pool);
  });
});
