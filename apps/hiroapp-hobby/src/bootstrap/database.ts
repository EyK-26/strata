import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { SqlDatabaseConnection } from "@getstrata/core/database/baseRepository";
import { bindDatabaseConnection } from "@getstrata/core/database/boundConnection";
import { registerDefaultDatabasePool } from "@getstrata/core/database/defaultConnection";
import { useSqlDialect } from "@getstrata/core/database/dialect";
import { createSqliteConnection } from "@getstrata/core/database/sqliteConnection";

export type SqlClient = {
  unsafe<T>(query: string, params?: readonly unknown[]): Promise<T[]>;
  close?: () => Promise<void> | void;
};

let sql: SqlClient | null = null;

function sqliteFilename(url: string): string {
  const trimmed = url.trim();
  if (trimmed === ":memory:" || trimmed === "sqlite::memory:") {
    return ":memory:";
  }
  if (trimmed.startsWith("sqlite:")) {
    return trimmed.slice("sqlite:".length).replace(/^\/\//, "") || "./storage/app.sqlite";
  }
  return trimmed || "./storage/app.sqlite";
}

function asSqlPool(client: SqlClient): SqlDatabaseConnection {
  const tagged = async () => {
    throw new Error(
      "SQLite starter connections do not run tagged SQL. Keep TENANCY_DRIVER=none or use Postgres.",
    );
  };
  return Object.assign(tagged, client) as SqlDatabaseConnection;
}

export function getSql(): SqlClient {
  if (sql) {
    return sql;
  }

  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error("DATABASE_URL is required");
  }

  useSqlDialect("sqlite");
  const filename = sqliteFilename(url);
  if (filename !== ":memory:") {
    mkdirSync(dirname(filename), { recursive: true });
  }
  sql = createSqliteConnection(filename);
  bindDatabaseConnection(sql);
  registerDefaultDatabasePool(asSqlPool(sql));
  return sql;
}

export async function pingDatabase(): Promise<boolean> {
  try {
    await getSql().unsafe("SELECT 1");
    return true;
  } catch {
    return false;
  }
}

export async function closeDatabase() {
  if (sql?.close) {
    await sql.close();
  }
  sql = null;
}
