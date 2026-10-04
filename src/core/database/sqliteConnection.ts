import { Database } from "bun:sqlite";
import {
  type ActiveDatabaseHandle,
  getActiveDatabaseConnection,
  runWithDatabaseConnection,
} from "./connectionContext.ts";

type SqliteConnection = ActiveDatabaseHandle & {
  begin<T>(callback: (transaction: ActiveDatabaseHandle) => Promise<T>): Promise<T>;
  close(): void;
};

function isRowReturning(sql: string): boolean {
  const upper = sql.replace(/\s+/g, " ").trim().toUpperCase();
  if (upper.includes(" RETURNING ")) {
    return true;
  }
  return (
    upper.startsWith("SELECT") ||
    upper.startsWith("WITH") ||
    upper.startsWith("PRAGMA") ||
    upper.startsWith("EXPLAIN")
  );
}

function createSqliteConnection(filename: string): SqliteConnection {
  if (!filename.trim()) {
    throw new Error("SQLite path is not configured. Pass a filename or :memory:.");
  }

  const db = new Database(filename, { create: true });
  db.exec("PRAGMA foreign_keys = ON");
  // Web apps run concurrent requests against one file: WAL lets readers proceed
  // during writes and busy_timeout waits instead of throwing SQLITE_BUSY.
  db.exec("PRAGMA busy_timeout = 5000");
  if (filename !== ":memory:") {
    db.exec("PRAGMA journal_mode = WAL");
    db.exec("PRAGMA synchronous = NORMAL");
  }

  let tail = Promise.resolve();
  let pending = 0;
  let closed = false;
  const transactions = new WeakSet<ActiveDatabaseHandle>();

  function execute<T>(query: string, params: readonly unknown[]): T[] {
    const statement = db.query(query);
    const args = [...params] as never[];
    if (isRowReturning(query)) return statement.all(...args) as T[];
    statement.run(...args);
    return [];
  }

  function enqueue<T>(operation: () => T | Promise<T>): Promise<T> {
    if (closed) return Promise.reject(new Error("SQLite connection is closed."));
    pending++;
    const result = tail.then(operation).finally(() => {
      pending--;
    });
    tail = result.then(
      () => {},
      () => {},
    );
    return result;
  }

  const connection: SqliteConnection = {
    async unsafe<T>(query: string, params: readonly unknown[] = []): Promise<T[]> {
      const active = getActiveDatabaseConnection(connection);
      if (transactions.has(active)) return active.unsafe<T>(query, params);
      return enqueue(() => execute<T>(query, params));
    },
    async begin<T>(callback: (transaction: ActiveDatabaseHandle) => Promise<T>): Promise<T> {
      if (transactions.has(getActiveDatabaseConnection(connection))) {
        throw new Error("Use runInTransaction for nested SQLite transactions.");
      }
      return enqueue(async () => {
        db.exec("BEGIN IMMEDIATE");
        let open = true;
        const transaction: ActiveDatabaseHandle = {
          async unsafe<TValue>(query: string, params: readonly unknown[] = []): Promise<TValue[]> {
            if (!open) throw new Error("SQLite transaction is no longer active.");
            return execute<TValue>(query, params);
          },
        };
        transactions.add(transaction);
        try {
          const result = await runWithDatabaseConnection(transaction, () => callback(transaction));
          db.exec("COMMIT");
          return result;
        } catch (error) {
          db.exec("ROLLBACK");
          throw error;
        } finally {
          open = false;
        }
      });
    },
    close(): void {
      if (pending > 0) throw new Error("Drain SQLite operations before closing the connection.");
      closed = true;
      db.close();
    },
  };
  return connection;
}

export type { SqliteConnection };
export { createSqliteConnection };
