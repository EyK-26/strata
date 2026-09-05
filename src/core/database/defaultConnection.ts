import type { SqlDatabaseConnection } from "./baseRepository";
import { createDatabaseQueryProxy } from "./queryProxy";

const DEFAULT_CONNECTION_KEY = Symbol.for("@getstrata/defaultDatabaseConnection");

type DefaultConnectionState = {
  pool: SqlDatabaseConnection | null;
  query: SqlDatabaseConnection | null;
};

function defaultConnectionState(): DefaultConnectionState {
  const globalRecord = globalThis as Record<symbol, DefaultConnectionState | undefined>;
  const existing = globalRecord[DEFAULT_CONNECTION_KEY];
  if (existing) {
    return existing;
  }

  const created: DefaultConnectionState = { pool: null, query: null };
  globalRecord[DEFAULT_CONNECTION_KEY] = created;
  return created;
}

function registerDefaultDatabasePool(connection: SqlDatabaseConnection): void {
  const holder = defaultConnectionState();
  holder.pool = connection;
  holder.query = createDatabaseQueryProxy(connection);
}

function getDefaultDatabasePool(): SqlDatabaseConnection {
  const pool = defaultConnectionState().pool;
  if (!pool) {
    throw new Error(
      "Default database pool is not registered. Call registerDefaultDatabasePool() during app bootstrap.",
    );
  }

  return pool;
}

function getDefaultDatabaseQuery(): SqlDatabaseConnection {
  const query = defaultConnectionState().query;
  if (!query) {
    throw new Error(
      "Default database query handle is not registered. Call registerDefaultDatabasePool() during app bootstrap.",
    );
  }

  return query;
}

function resetDefaultDatabasePoolForTests(): void {
  const holder = defaultConnectionState();
  holder.pool = null;
  holder.query = null;
}

export {
  getDefaultDatabasePool,
  getDefaultDatabaseQuery,
  registerDefaultDatabasePool,
  resetDefaultDatabasePoolForTests,
};
