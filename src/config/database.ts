interface DatabaseConfig {
  url: string;
  poolMax: number;
  idleTimeoutSeconds: number;
  maxLifetimeSeconds: number;
  connectionTimeoutSeconds: number;
}

function readInteger(name: string, fallback: number): number {
  const parsed = Number.parseInt(process.env[name] ?? String(fallback), 10);

  return Number.isInteger(parsed) && parsed >= 0 ? parsed : fallback;
}

const databaseConfig: DatabaseConfig = {
  url: process.env.DATABASE_URL ?? "",
  poolMax: readInteger("DB_POOL_MAX", 10),
  idleTimeoutSeconds: readInteger("DB_POOL_IDLE_TIMEOUT", 30),
  maxLifetimeSeconds: readInteger("DB_POOL_MAX_LIFETIME", 3600),
  connectionTimeoutSeconds: readInteger("DB_CONNECTION_TIMEOUT", 10),
};

export type { DatabaseConfig };
export { databaseConfig };
