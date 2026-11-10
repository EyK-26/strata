import { SQL } from "bun";

interface CreateBunSqlPoolOptions {
  url: string;
  max?: number;
  idleTimeout?: number;
  maxLifetime?: number;
  connectionTimeout?: number;
}

function createNativePostgresPool(options: CreateBunSqlPoolOptions): InstanceType<typeof SQL> {
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

export type { CreateBunSqlPoolOptions };
export { createNativePostgresPool };
