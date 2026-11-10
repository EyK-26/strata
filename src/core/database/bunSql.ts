import { bindDatabaseConnection } from "./boundConnection";
import type { DatabaseConnection, SqlDatabaseConnection } from "./connectionContracts";
import { registerDefaultDatabasePool } from "./defaultConnection";

import { type CreateBunSqlPoolOptions, createNativePostgresPool } from "./postgresNative";

const createBunSqlPool = createNativePostgresPool;

function bindBunSql(sql: DatabaseConnection): DatabaseConnection {
  bindDatabaseConnection(sql);
  registerDefaultDatabasePool(sql as SqlDatabaseConnection);
  return sql;
}

export type { CreateBunSqlPoolOptions };
export { bindBunSql, createBunSqlPool };
