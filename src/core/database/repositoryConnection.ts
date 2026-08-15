import type { SqlDatabaseConnection } from "./baseRepository";
import { getBoundDatabaseConnection } from "./boundConnection";
import { getDefaultDatabaseQuery } from "./defaultConnection";

function resolveRepositoryConnection(): SqlDatabaseConnection {
  return (getBoundDatabaseConnection() ?? getDefaultDatabaseQuery()) as SqlDatabaseConnection;
}

const repositoryConnection = new Proxy(
  function repositoryConnection() {} as unknown as SqlDatabaseConnection,
  {
    apply(_target, _thisArg, args) {
      return (resolveRepositoryConnection() as unknown as (...args: unknown[]) => unknown)(...args);
    },
    get(_target, property) {
      const connection = resolveRepositoryConnection();
      const value = (connection as unknown as Record<string | symbol, unknown>)[property];

      return typeof value === "function" ? value.bind(connection) : value;
    },
  },
);

export { repositoryConnection, resolveRepositoryConnection };
