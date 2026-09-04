import type { SqlDatabaseConnection } from "@getstrata/core/database/baseRepository";
import {
  bindDatabaseConnection,
  getBoundDatabaseConnection,
} from "@getstrata/core/database/boundConnection";
import { createBunSqlPool } from "@getstrata/core/database/bunSql";
import {
  getDefaultDatabaseQuery,
  registerDefaultDatabasePool,
} from "@getstrata/core/database/defaultConnection";
import { registerHiroModels } from "../models/register.ts";
import { loadEnv } from "./config.ts";

let pool: SqlDatabaseConnection | undefined;

export function bindDatabase() {
  if (pool) {
    registerHiroModels();
    return getBoundDatabaseConnection() ?? getDefaultDatabaseQuery();
  }

  const env = loadEnv();
  pool = createBunSqlPool({
    url: env.DATABASE_URL,
    max: Number(process.env.DB_POOL_MAX ?? "10"),
    idleTimeout: Number(process.env.DB_POOL_IDLE_TIMEOUT ?? "30"),
    maxLifetime: Number(process.env.DB_POOL_MAX_LIFETIME ?? "3600"),
    connectionTimeout: Number(process.env.DB_CONNECTION_TIMEOUT ?? "10"),
  }) as SqlDatabaseConnection;
  registerDefaultDatabasePool(pool);
  // Bind the ALS-aware query proxy, not the raw pool, so tenant SET LOCAL applies.
  bindDatabaseConnection(getDefaultDatabaseQuery());
  registerHiroModels();
  return getDefaultDatabaseQuery();
}
