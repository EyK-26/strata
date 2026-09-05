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

function createMysqlConnection(url: string): MysqlConnection {
  if (!url.trim()) {
    throw new Error("MYSQL_URL is not configured. Set url before creating a MySQL pool.");
  }
  return createMysqlConnectionFromPool(mysql.createPool(url) as MysqlExecutable);
}

export type { MysqlConnection, MysqlExecutable };
export { createMysqlConnection, createMysqlConnectionFromPool };
