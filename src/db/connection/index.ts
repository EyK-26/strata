import { databaseConfig } from "../../config/database";
import {
  createDatabaseConnection,
  type DatabaseConnection,
} from "./createConnection";

const connectionHolder = {
  connection: createDatabaseConnection(databaseConfig),
};

function getDatabase(): DatabaseConnection {
  return connectionHolder.connection;
}

async function pingDatabase(
  connection: DatabaseConnection = getDatabase(),
): Promise<boolean> {
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

  await getDatabase().close().catch(() => undefined);
  connectionHolder.connection = createDatabaseConnection(databaseConfig);
  return getDatabase();
}

async function closeDatabase(): Promise<void> {
  await getDatabase().close();
}

function resetDatabaseConnectionForTests(connection: DatabaseConnection): void {
  connectionHolder.connection = connection;
}

const db = new Proxy(function database() {} as unknown as DatabaseConnection, {
  apply(_target, _thisArg, args) {
    return (getDatabase() as unknown as (...args: unknown[]) => unknown)(...args);
  },
  get(_target, property) {
    const value = (getDatabase() as unknown as Record<string | symbol, unknown>)[
      property
    ];

    return typeof value === "function" ? value.bind(getDatabase()) : value;
  },
});

export default db;
export {
  closeDatabase,
  ensureDatabaseConnection,
  getDatabase,
  pingDatabase,
  resetDatabaseConnectionForTests,
};
export type { DatabaseConnection };
