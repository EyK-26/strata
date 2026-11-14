import { missingOptionalPeer } from "../runtime/optionalPeer.ts";

type MysqlPromiseModule = {
  createPool: (config: {
    uri: string;
    timezone: string;
    supportBigNumbers: true;
    bigNumberStrings: false;
    connectionLimit?: number;
  }) => MysqlPool;
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

type MysqlSocket = {
  readonly closed?: boolean;
  once(event: "close", listener: () => void): unknown;
  removeListener(event: "close", listener: () => void): unknown;
};
type MysqlPoolConnection = MysqlExecutable & {
  readonly connection?: { readonly stream?: MysqlSocket };
  beginTransaction(): Promise<void>;
  commit(): Promise<void>;
  rollback(): Promise<void>;
  release(): void;
  destroy(): void;
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

function pinSessionToUtc(connection: RawPoolConnection): void {
  connection.query(MYSQL_SESSION_UTC, (error) => {
    if (error) {
      console.warn(
        "[mysql] Could not set the session time zone to UTC; DATETIME comparisons may drift.",
      );
    }
  });
}

function createPoolFromModule(mysql: MysqlPromiseModule, url: string, max?: number): MysqlPool {
  // UTC on both sides: the driver parses DATETIME as UTC and NOW() runs in a UTC session.
  const pool = mysql.createPool({
    uri: url,
    timezone: "Z",
    supportBigNumbers: true,
    bigNumberStrings: false,
    ...(max === undefined ? {} : { connectionLimit: max }),
  });
  pool.on("connection", (connection) => {
    pinSessionToUtc(connection as RawPoolConnection);
  });
  return pool;
}

async function createMysqlPool(url: string, max?: number): Promise<MysqlPool> {
  return createPoolFromModule(await loadMysql(), url, max);
}

export type { MysqlExecutable, MysqlPool, MysqlPoolConnection, MysqlSocket };
export { createMysqlPool, executeMysql, loadMysql, resetMysqlLoaderForTests };
