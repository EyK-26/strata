import { SQL } from "bun";
import type { DatabaseConfig } from "../../config/database";

type DatabaseConnection = InstanceType<typeof SQL>;

function createDatabaseConnection(config: DatabaseConfig): DatabaseConnection {
  if (!config.url) {
    throw new Error(
      "DATABASE_URL is not configured. Set DATABASE_URL before starting the app or running integration tests.",
    );
  }

  return new SQL({
    url: config.url,
    max: config.poolMax,
    idleTimeout: config.idleTimeoutSeconds,
    maxLifetime: config.maxLifetimeSeconds,
    connectionTimeout: config.connectionTimeoutSeconds,
  });
}

export type { DatabaseConnection };
export { createDatabaseConnection };
