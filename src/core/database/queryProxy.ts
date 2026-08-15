import type { DatabaseConnection, SqlDatabaseConnection } from "./baseRepository";
import { getActiveDatabaseConnection } from "./connectionContext";

const POOL_CONNECTION_METHODS = new Set(["begin", "close", "connect"]);

function createDatabaseQueryProxy(pool: SqlDatabaseConnection): SqlDatabaseConnection {
  function resolveDatabase(): SqlDatabaseConnection {
    return getActiveDatabaseConnection(pool) as SqlDatabaseConnection;
  }

  function resolveDatabaseForProperty(
    property: string | symbol,
  ): SqlDatabaseConnection | DatabaseConnection {
    if (typeof property === "string" && POOL_CONNECTION_METHODS.has(property)) {
      return pool;
    }

    return resolveDatabase();
  }

  return new Proxy(function database() {} as unknown as SqlDatabaseConnection, {
    apply(_target, _thisArg, args) {
      return (resolveDatabase() as unknown as (...args: unknown[]) => unknown)(...args);
    },
    get(_target, property) {
      const connection = resolveDatabaseForProperty(property);
      const value = (connection as unknown as Record<string | symbol, unknown>)[property];

      return typeof value === "function" ? value.bind(connection) : value;
    },
  });
}

export { createDatabaseQueryProxy };
