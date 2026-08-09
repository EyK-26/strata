import { databaseConfig } from "../../config/database";
import { getActiveDatabaseConnection } from "../../core/database/connectionContext";
import { createDatabaseConnection, type DatabaseConnection } from "./createConnection";

const connectionHolder: { connection: DatabaseConnection | null } = {
  connection: null,
};

function getDatabase(): DatabaseConnection {
  if (!connectionHolder.connection) {
    connectionHolder.connection = createDatabaseConnection(databaseConfig);
  }

  return connectionHolder.connection;
}

async function pingDatabase(connection: DatabaseConnection = getDatabase()): Promise<boolean> {
  try {
    await connection`SELECT 1`;
    return true;
  } catch {
    return false;
  }
}

async function ensureDatabaseConnection(): Promise<DatabaseConnection> {
  if (await pingDatabase()) {
    return getDatabase();
  }

  await getDatabase()
    .close()
    .catch(() => undefined);
  connectionHolder.connection = createDatabaseConnection(databaseConfig);
  return getDatabase();
}

async function closeDatabase(): Promise<void> {
  await getDatabase().close();
}

async function replaceDatabaseConnectionForTests(
  connection: DatabaseConnection = createDatabaseConnection(databaseConfig),
): Promise<void> {
  const previous = connectionHolder.connection;
  connectionHolder.connection = connection;

  if (previous && previous !== connection && typeof previous.close === "function") {
    await previous.close().catch(() => undefined);
  }
}

function resetDatabaseConnectionForTests(connection: DatabaseConnection): void {
  connectionHolder.connection = connection;
}

const POOL_CONNECTION_METHODS = new Set(["begin", "close", "connect"]);

function resolveDatabase(): DatabaseConnection {
  return getActiveDatabaseConnection(getDatabase());
}

function resolveDatabaseForProperty(property: string | symbol): DatabaseConnection {
  if (typeof property === "string" && POOL_CONNECTION_METHODS.has(property)) {
    return getDatabase();
  }

  return resolveDatabase();
}

const db = new Proxy(function database() {} as unknown as DatabaseConnection, {
  apply(_target, _thisArg, args) {
    return (resolveDatabase() as unknown as (...args: unknown[]) => unknown)(...args);
  },
  get(_target, property) {
    const connection = resolveDatabaseForProperty(property);
    const value = (connection as unknown as Record<string | symbol, unknown>)[property];

    return typeof value === "function" ? value.bind(connection) : value;
  },
});

export default db;
export type { DatabaseConnection };
export {
  closeDatabase,
  ensureDatabaseConnection,
  getDatabase,
  pingDatabase,
  replaceDatabaseConnectionForTests,
  resetDatabaseConnectionForTests,
};
