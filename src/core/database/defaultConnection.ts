import type { SqlDatabaseConnection } from "./baseRepository";
import { createDatabaseQueryProxy } from "./queryProxy";

const defaultPool: { connection: SqlDatabaseConnection | null } = {
  connection: null,
};

const defaultQuery: { connection: SqlDatabaseConnection | null } = {
  connection: null,
};

function registerDefaultDatabasePool(connection: SqlDatabaseConnection): void {
  defaultPool.connection = connection;
  defaultQuery.connection = createDatabaseQueryProxy(connection);
}

function getDefaultDatabasePool(): SqlDatabaseConnection {
  if (!defaultPool.connection) {
    throw new Error(
      "Default database pool is not registered. Call registerDefaultDatabasePool() during app bootstrap.",
    );
  }

  return defaultPool.connection;
}

function getDefaultDatabaseQuery(): SqlDatabaseConnection {
  if (!defaultQuery.connection) {
    throw new Error(
      "Default database query handle is not registered. Call registerDefaultDatabasePool() during app bootstrap.",
    );
  }

  return defaultQuery.connection;
}

function resetDefaultDatabasePoolForTests(): void {
  defaultPool.connection = null;
  defaultQuery.connection = null;
}

export {
  getDefaultDatabasePool,
  getDefaultDatabaseQuery,
  registerDefaultDatabasePool,
  resetDefaultDatabasePoolForTests,
};
