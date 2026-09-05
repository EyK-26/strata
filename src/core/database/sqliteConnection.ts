import { Database } from "bun:sqlite";
import type { ActiveDatabaseHandle } from "./connectionContext.ts";

type SqliteConnection = ActiveDatabaseHandle & {
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

  return {
    async unsafe<T>(query: string, params: readonly unknown[] = []): Promise<T[]> {
      const statement = db.query(query);
      const args = [...params] as never[];
      if (isRowReturning(query)) {
        return statement.all(...args) as T[];
      }
      statement.run(...args);
      return [];
    },
    close(): void {
      db.close();
    },
  };
}

export type { SqliteConnection };
export { createSqliteConnection };
