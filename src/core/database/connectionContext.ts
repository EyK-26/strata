import { AsyncLocalStorage } from "node:async_hooks";

type ActiveDatabaseHandle = {
  unsafe<T>(query: string, params?: readonly unknown[]): Promise<T[]>;
};

const activeConnection = new AsyncLocalStorage<ActiveDatabaseHandle>();

function runWithDatabaseConnection<T>(
  connection: ActiveDatabaseHandle,
  callback: () => T | Promise<T>,
): T | Promise<T> {
  return activeConnection.run(connection, callback);
}

function getActiveDatabaseConnection<T extends ActiveDatabaseHandle>(fallback: T): T {
  return (activeConnection.getStore() as T | undefined) ?? fallback;
}

function hasActiveDatabaseConnection(): boolean {
  return activeConnection.getStore() !== undefined;
}

export type { ActiveDatabaseHandle };
export { getActiveDatabaseConnection, hasActiveDatabaseConnection, runWithDatabaseConnection };
