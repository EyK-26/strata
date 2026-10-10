import { missingOptionalPeer } from "../runtime/optionalPeer.ts";
import type { DatabaseConnection } from "./baseRepository.ts";
import {
  type ActiveDatabaseHandle,
  getActiveDatabaseConnection,
  runWithDatabaseConnection,
} from "./connectionContext.ts";
import {
  observeIsolatedReadOnly,
  type ReadOnlyObservationOptions,
} from "./isolatedReadOnlyObservation.ts";

type MysqlPromiseModule = {
  createPool: (config: { uri: string; timezone: string }) => MysqlPool;
};

type MysqlExecutable = {
  execute: (sql: string, params?: unknown[]) => Promise<[unknown, unknown]>;
  query?: (sql: string) => Promise<[unknown, unknown]>;
  end?: () => Promise<void>;
  getConnection?: () => Promise<MysqlPoolConnection>;
};

type MysqlPool = MysqlExecutable & {
  end(): Promise<void>;
  on(event: "connection", listener: (connection: unknown) => void): void;
};

type MysqlPoolConnection = MysqlExecutable & {
  beginTransaction(): Promise<void>;
  commit(): Promise<void>;
  rollback(): Promise<void>;
  release(): void;
  destroy(): void;
};

type MysqlConnection = ActiveDatabaseHandle & {
  begin<T>(callback: (transaction: ActiveDatabaseHandle) => Promise<T>): Promise<T>;
  close(): Promise<void>;
  observeReadOnly<T>(
    operation: (connection: DatabaseConnection) => Promise<T>,
    options: ReadOnlyObservationOptions,
  ): Promise<T>;
};

const MYSQL_SESSION_UTC = "SET time_zone = '+00:00'";

type RawPoolConnection = {
  query: (sql: string, callback: (error: unknown) => void) => unknown;
};

type MysqlModuleLike = MysqlPromiseModule | { default?: MysqlPromiseModule };

let mysqlModule: MysqlPromiseModule | undefined;
let mysqlPending: Promise<MysqlPromiseModule> | undefined;
let importMysql: () => Promise<MysqlModuleLike> = defaultImportMysql;

async function defaultImportMysql(): Promise<MysqlModuleLike> {
  return import("mysql2/promise") as Promise<MysqlModuleLike>;
}

function resetMysqlLoaderForTests(importer?: () => Promise<unknown>): void {
  mysqlModule = undefined;
  mysqlPending = undefined;
  importMysql = importer ? async () => (await importer()) as MysqlModuleLike : defaultImportMysql;
}

function mysqlApi(mod: MysqlModuleLike): MysqlPromiseModule {
  if (typeof (mod as MysqlPromiseModule).createPool === "function") {
    return mod as MysqlPromiseModule;
  }
  const withDefault = mod as { default?: MysqlPromiseModule };
  if (typeof withDefault.default?.createPool === "function") {
    return withDefault.default;
  }
  throw new Error("mysql2/promise did not export createPool.");
}

async function loadMysql(): Promise<MysqlPromiseModule> {
  if (mysqlModule) {
    return mysqlModule;
  }
  if (!mysqlPending) {
    mysqlPending = (async () => {
      let mod: MysqlModuleLike;
      try {
        mod = await importMysql();
      } catch (error: unknown) {
        mysqlPending = undefined;
        throw missingOptionalPeer("mysql2", "to open a MySQL connection", error);
      }
      try {
        mysqlModule = mysqlApi(mod);
        return mysqlModule;
      } catch (error: unknown) {
        mysqlPending = undefined;
        throw error;
      }
    })();
  }
  return mysqlPending;
}

function rowsFromResult<T>(result: unknown): T[] {
  if (Array.isArray(result)) {
    return result as T[];
  }
  if (result && typeof result === "object") {
    return [result as T];
  }
  return [];
}

async function executeMysql<T>(
  target: MysqlExecutable,
  query: string,
  params: readonly unknown[],
): Promise<T[]> {
  // Savepoints and some DDL cannot use MySQL's prepared-statement protocol.
  // Parameterized operations still use execute() for bound values.
  const [result] =
    params.length === 0 && target.query
      ? await target.query(query)
      : await target.execute(query, [...params]);
  return rowsFromResult<T>(result);
}

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
        throw new Error("Use runInTransaction for nested MySQL transactions.");
      }
      const pool = await getPool();
      if (!pool.getConnection)
        throw new Error("MySQL transactions require a pool with getConnection().");
      const reserved = await pool.getConnection();
      let open = false;
      let discard = false;
      const transaction: ActiveDatabaseHandle = {
        async unsafe<TValue>(query: string, params: readonly unknown[] = []): Promise<TValue[]> {
          if (!open) throw new Error("MySQL transaction is no longer active.");
          return executeMysql<TValue>(reserved, query, params);
        },
      };
      transactions.add(transaction);
      try {
        await reserved.beginTransaction();
        open = true;
        const result = await runWithDatabaseConnection(transaction, () => callback(transaction));
        await reserved.commit();
        return result;
      } catch (error) {
        if (open) {
          try {
            await reserved.rollback();
          } catch (rollbackError) {
            discard = true;
            reserved.destroy();
            throw new AggregateError(
              [error, rollbackError],
              "MySQL rollback failed; connection discarded.",
            );
          }
        } else {
          discard = true;
          reserved.destroy();
        }
        throw error;
      } finally {
        open = false;
        if (!discard) reserved.release();
      }
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

function pinSessionToUtc(connection: RawPoolConnection): void {
  connection.query(MYSQL_SESSION_UTC, (error) => {
    if (error) {
      console.warn(
        `[mysql] Could not set the session time zone to UTC; DATETIME comparisons may drift: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  });
}

function createPoolFromModule(mysql: MysqlPromiseModule, url: string): MysqlPool {
  // UTC on both sides: the driver parses DATETIME as UTC and NOW() runs in a UTC session.
  const pool = mysql.createPool({ uri: url, timezone: "Z" });
  pool.on("connection", (connection) => {
    pinSessionToUtc(connection as RawPoolConnection);
  });
  return pool;
}

async function createMysqlPool(url: string): Promise<MysqlPool> {
  return createPoolFromModule(await loadMysql(), url);
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
