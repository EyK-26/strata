interface DatabaseConnection {
  unsafe<T>(query: string, params?: readonly unknown[]): Promise<T[]>;
  begin?<T>(callback: (transaction: DatabaseConnection) => Promise<T>): Promise<T>;
  /** Optional native cancellable pool checkout; absence must not be silently emulated. */
  reserve?(options: {
    signal?: AbortSignal;
  }): Promise<DatabaseConnection & { release(): void | Promise<void> }>;
  /** Optional independent, interruptible read-only observation; no business transaction or pool slot. */
  observeReadOnly?<T>(
    operation: (connection: DatabaseConnection) => Promise<T>,
    options: { signal: AbortSignal; timeoutMs: number },
  ): Promise<T>;
  /** SQLite closes synchronously; pooled drivers return a promise. */
  close?(): void | Promise<void>;
}

interface SqlDatabaseConnection extends DatabaseConnection {
  (strings: TemplateStringsArray, ...values: unknown[]): Promise<unknown[]>;
}

export type { DatabaseConnection, SqlDatabaseConnection };
