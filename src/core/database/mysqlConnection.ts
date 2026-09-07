import { missingOptionalPeer } from "../runtime/optionalPeer.ts";
import type { ActiveDatabaseHandle } from "./connectionContext.ts";

type MysqlPromiseModule = {
  createPool: (config: { uri: string; timezone: string }) => MysqlPool;
};

type MysqlExecutable = {
  execute: (sql: string, params?: unknown[]) => Promise<[unknown, unknown]>;
  end?: () => Promise<void>;
};

type MysqlPool = MysqlExecutable & {
  end(): Promise<void>;
  on(event: "connection", listener: (connection: unknown) => void): void;
};

type MysqlConnection = ActiveDatabaseHandle & {
  close(): Promise<void>;
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

function createMysqlConnectionFromPool(pool: MysqlExecutable): MysqlConnection {
  return {
    async unsafe<T>(query: string, params: readonly unknown[] = []): Promise<T[]> {
      const [result] = await pool.execute(query, [...params]);
      return rowsFromResult<T>(result);
    },
    async close(): Promise<void> {
      if (typeof pool.end === "function") {
        await pool.end();
      }
    },
  };
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

  return {
    async unsafe<T>(query: string, params: readonly unknown[] = []): Promise<T[]> {
      const [result] = await (await ensurePool()).execute(query, [...params]);
      return rowsFromResult<T>(result);
    },
    async close(): Promise<void> {
      if (!poolPending) {
        return;
      }
      const pending = poolPending;
      poolPending = undefined;
      const pool = await pending.catch(() => undefined);
      await pool?.end();
    },
  };
}

export type { MysqlConnection, MysqlExecutable, MysqlPool };
export {
  createMysqlConnection,
  createMysqlConnectionFromPool,
  createMysqlPool,
  resetMysqlLoaderForTests,
};
