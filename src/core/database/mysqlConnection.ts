import {
  createMysqlPool,
  executeMysql,
  loadMysql,
  type MysqlExecutable,
  type MysqlPool,
  type MysqlPoolConnection,
  resetMysqlLoaderForTests,
} from "#strata-mysql-native";
import {
  type ActiveDatabaseHandle,
  getActiveDatabaseConnection,
  runWithDatabaseConnection,
} from "./connectionContext.ts";
import type { DatabaseConnection } from "./connectionContracts.ts";
import {
  observeIsolatedReadOnly,
  type ReadOnlyObservationOptions,
} from "./isolatedReadOnlyObservation.ts";
import { legacyNativeTransaction } from "./legacyNativeTransaction";
import { createMysqlPin } from "./rawMysql";

type MysqlConnection = ActiveDatabaseHandle & {
  begin<T>(callback: (transaction: ActiveDatabaseHandle) => Promise<T>): Promise<T>;
  close(): Promise<void>;
  observeReadOnly<T>(
    operation: (connection: DatabaseConnection) => Promise<T>,
    options: ReadOnlyObservationOptions,
  ): Promise<T>;
};

function createMysqlAdapter(
  getPool: () => Promise<MysqlExecutable>,
  close: () => Promise<void>,
  observer?: <T>(
    operation: (connection: DatabaseConnection) => Promise<T>,
    options: ReadOnlyObservationOptions,
  ) => Promise<T>,
): MysqlConnection {
  const transactions = new WeakSet<ActiveDatabaseHandle>();
  const observations = new Set<Promise<unknown>>();
  let observationsClosed = false;
  const connection: MysqlConnection = {
    async unsafe<T>(query: string, params: readonly unknown[] = []): Promise<T[]> {
      const active = getActiveDatabaseConnection(connection);
      if (transactions.has(active)) return active.unsafe<T>(query, params);
      return executeMysql<T>(await getPool(), query, params);
    },
    async begin<T>(callback: (transaction: ActiveDatabaseHandle) => Promise<T>): Promise<T> {
      if (transactions.has(getActiveDatabaseConnection(connection))) {
        throw new Error("Use the active transaction handle for nested MySQL work.");
      }
      const pool = await getPool();
      if (!pool.getConnection)
        throw new Error("MySQL transactions require a pool with getConnection().");
      const reserved = await pool.getConnection();
      return legacyNativeTransaction(createMysqlPin(reserved), callback, transactions);
    },
    async observeReadOnly<T>(
      operation: (connection: DatabaseConnection) => Promise<T>,
      options: ReadOnlyObservationOptions,
    ): Promise<T> {
      if (observationsClosed) throw new Error("MySQL observations are closed.");
      if (!observer) throw new Error("MySQL observations require the URL-backed official adapter.");
      const work = observer(async (transaction) => {
        transactions.add(transaction);
        return await runWithDatabaseConnection(transaction, () => operation(transaction));
      }, options);
      observations.add(work);
      try {
        return await work;
      } finally {
        observations.delete(work);
      }
    },
    async close() {
      observationsClosed = true;
      await Promise.allSettled([...observations]);
      await close();
    },
  };
  return connection;
}

function createMysqlConnectionFromPool(pool: MysqlExecutable): MysqlConnection {
  return createMysqlAdapter(
    async () => pool,
    async () => {
      await pool.end?.();
    },
  );
}

function createMysqlConnection(url: string): MysqlConnection {
  if (!url.trim()) {
    throw new Error("MYSQL_URL is not configured. Set url before creating a MySQL pool.");
  }

  // Cache the promise, not the pool: concurrent first queries must share one pool.
  let poolPending: Promise<MysqlPool> | undefined;

  function ensurePool(): Promise<MysqlPool> {
    if (!poolPending) {
      poolPending = createMysqlPool(url).catch((error: unknown) => {
        poolPending = undefined;
        throw error;
      });
    }
    return poolPending;
  }

  return createMysqlAdapter(
    ensurePool,
    async () => {
      if (!poolPending) return;
      const pending = poolPending;
      poolPending = undefined;
      const pool = await pending.catch(() => undefined);
      await pool?.end();
    },
    async (operation, options) => {
      // Reuse optional-peer diagnostics before resolving the child's module.
      await loadMysql();
      const module = import.meta.resolve("mysql2/promise");
      return await observeIsolatedReadOnly({ driver: "mysql", url, module }, operation, options);
    },
  );
}

export type { MysqlConnection, MysqlExecutable, MysqlPool, MysqlPoolConnection };
export {
  createMysqlConnection,
  createMysqlConnectionFromPool,
  createMysqlPool,
  resetMysqlLoaderForTests,
};
