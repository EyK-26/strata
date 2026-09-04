import { getBoundDatabaseConnection } from "@getstrata/core/database/boundConnection";
import { bindBunSql, createBunSqlPool } from "@getstrata/core/database/bunSql";
import { registerHiroModels } from "../models/register.ts";
import { loadEnv } from "./config.ts";

export function bindDatabase() {
  const existing = getBoundDatabaseConnection();
  if (existing) {
    registerHiroModels();
    return existing;
  }

  const env = loadEnv();
  const pool = createBunSqlPool({
    url: env.DATABASE_URL,
    max: Number(process.env.DB_POOL_MAX ?? "10"),
    idleTimeout: Number(process.env.DB_POOL_IDLE_TIMEOUT ?? "30"),
    maxLifetime: Number(process.env.DB_POOL_MAX_LIFETIME ?? "3600"),
    connectionTimeout: Number(process.env.DB_CONNECTION_TIMEOUT ?? "10"),
  });

  const connection = bindBunSql(pool);
  registerHiroModels();
  return connection;
}
