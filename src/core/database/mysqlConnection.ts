import mysql from "mysql2/promise";
import type { ActiveDatabaseHandle } from "./connectionContext.ts";

type MysqlExecutable = {
  execute: (sql: string, params?: unknown[]) => Promise<[unknown, unknown]>;
  end?: () => Promise<void>;
};

type MysqlConnection = ActiveDatabaseHandle & {
  close(): Promise<void>;
};

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

const MYSQL_SESSION_UTC = "SET time_zone = '+00:00'";

type RawPoolConnection = {
  query: (sql: string, callback: (error: unknown) => void) => unknown;
};

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

function createMysqlPool(url: string): mysql.Pool {
  // UTC on both sides: the driver parses DATETIME as UTC and NOW() runs in a UTC session.
  const pool = mysql.createPool({ uri: url, timezone: "Z" });
  pool.on("connection", (connection) => {
    pinSessionToUtc(connection as unknown as RawPoolConnection);
  });
  return pool;
}

function createMysqlConnection(url: string): MysqlConnection {
  if (!url.trim()) {
    throw new Error("MYSQL_URL is not configured. Set url before creating a MySQL pool.");
  }
  return createMysqlConnectionFromPool(createMysqlPool(url) as MysqlExecutable);
}

export type { MysqlConnection, MysqlExecutable };
export { createMysqlConnection, createMysqlConnectionFromPool, createMysqlPool };
