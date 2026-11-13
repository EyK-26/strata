import { type CreateBunSqlPoolOptions, createNativePostgresPool } from "./postgresNative";

const createBunSqlPool = createNativePostgresPool;

export type { CreateBunSqlPoolOptions };
export { createBunSqlPool };
