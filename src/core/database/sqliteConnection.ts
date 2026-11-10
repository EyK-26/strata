import {
  type ActiveDatabaseHandle,
  getActiveDatabaseConnection,
  runWithDatabaseConnection,
} from "./connectionContext.ts";
import type { DatabaseConnection } from "./connectionContracts.ts";
import {
  observeIsolatedReadOnly,
  type ReadOnlyObservationOptions,
} from "./isolatedReadOnlyObservation.ts";
import { legacyNativeTransaction } from "./legacyNativeTransaction";
import { createRawSqlitePool, sqliteFilename } from "./rawSqlite";

type SqliteConnection = ActiveDatabaseHandle & {
  begin<T>(callback: (transaction: ActiveDatabaseHandle) => Promise<T>): Promise<T>;
  observeReadOnly<T>(
    operation: (connection: DatabaseConnection) => Promise<T>,
    options: ReadOnlyObservationOptions,
  ): Promise<T>;
  close(): void;
};

function createSqliteConnection(filename: string): SqliteConnection {
  const absoluteFilename = sqliteFilename(filename);
  const pool = createRawSqlitePool({ driver: "sqlite", filename });
  const transactions = new WeakSet<ActiveDatabaseHandle>();
  let observations = 0;
  let closed = false;
  const connection: SqliteConnection = {
    async unsafe<T>(query: string, params: readonly unknown[] = []): Promise<T[]> {
      const active = getActiveDatabaseConnection(connection);
      if (transactions.has(active)) return active.unsafe<T>(query, params);
      return [...(await pool.execute<T>({ text: query, params }))];
    },
    async begin<T>(callback: (transaction: ActiveDatabaseHandle) => Promise<T>): Promise<T> {
      if (transactions.has(getActiveDatabaseConnection(connection)))
        throw new Error("Use runInTransaction for nested SQLite transactions.");
      const outcome = await pool.checkout();
      if (!outcome.ok) throw outcome.error;
      return legacyNativeTransaction(outcome.value, callback, transactions);
    },
    async observeReadOnly<T>(
      operation: (connection: DatabaseConnection) => Promise<T>,
      options: ReadOnlyObservationOptions,
    ): Promise<T> {
      if (closed) throw new Error("SQLite connection is closed.");
      if (absoluteFilename === ":memory:")
        throw new Error("SQL observations require file-backed SQLite.");
      observations++;
      try {
        return await observeIsolatedReadOnly(
          { driver: "sqlite", filename: absoluteFilename },
          async (transaction) => {
            transactions.add(transaction);
            return await runWithDatabaseConnection(transaction, () => operation(transaction));
          },
          options,
        );
      } finally {
        observations--;
      }
    },
    close() {
      if (observations) throw new Error("Drain SQLite operations before closing the connection.");
      pool.close();
      closed = true;
    },
  };
  return connection;
}

export type { SqliteConnection };
export { createSqliteConnection };
