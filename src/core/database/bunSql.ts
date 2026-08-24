import { SQL } from "bun";
import type { DatabaseConnection, SqlDatabaseConnection } from "./baseRepository";
import { bindDatabaseConnection } from "./boundConnection";
import { registerDefaultDatabasePool } from "./defaultConnection";

interface CreateBunSqlPoolOptions {
  url: string;
  max?: number;
  idleTimeout?: number;
  maxLifetime?: number;
  connectionTimeout?: number;
}

function createBunSqlPool(options: CreateBunSqlPoolOptions): InstanceType<typeof SQL> {
  if (!options.url) {
    throw new Error("DATABASE_URL is not configured. Set url before creating a Bun SQL pool.");
  }

  return new SQL({
    url: options.url,
    max: options.max ?? 10,
    idleTimeout: options.idleTimeout ?? 30,
    maxLifetime: options.maxLifetime ?? 3600,
    connectionTimeout: options.connectionTimeout ?? 10,
  });
}

function bindBunSql(sql: DatabaseConnection): DatabaseConnection {
  bindDatabaseConnection(sql);
  registerDefaultDatabasePool(sql as SqlDatabaseConnection);
  return sql;
}

export type { CreateBunSqlPoolOptions };
export { bindBunSql, createBunSqlPool };
