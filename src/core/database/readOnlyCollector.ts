import { hasActiveDatabaseConnection, runWithDatabaseConnection } from "./connectionContext";
import { currentSqlDialect } from "./dialect";
import { repositoryConnection as db, resolveRepositoryConnection } from "./repositoryConnection";
import { hasActiveTransaction, runInTransaction } from "./transaction";

interface ReadOnlyCollector<T> {
  collect(): Promise<T>;
  close(): Promise<void>;
}
/** Internal shared observation lifecycle. No bypass, payload or tenant enumeration. */
function createReadOnlyCollector<T>(
  name: string,
  timeoutMs: number,
  collect: (remaining: () => number) => Promise<T>,
): ReadOnlyCollector<T> {
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 5000)
    throw new TypeError(`${name} timeout must be between 1 and 5000 milliseconds.`);
  let active: Promise<T> | undefined;
  let closed = false;
  return {
    async collect() {
      if (closed) throw new Error(`${name} collector is closed.`);
      if (hasActiveTransaction() || hasActiveDatabaseConnection())
        throw new Error(`${name} require an independent transaction.`);
      const driver = currentSqlDialect().driver;
      const pool = resolveRepositoryConnection();
      if (driver !== "pgsql" && driver !== "sqlite" && driver !== "mysql")
        throw new Error(`${name} require Postgres or an interruptible SQLite/MySQL adapter.`);
      if (active) throw new Error(`${name} collection is still settling.`);
      const deadline = performance.now() + timeoutMs;
      let expired = false;
      const acquisition = new AbortController();
      let timer: ReturnType<typeof setTimeout> | undefined;
      const remaining = () => {
        const value = Math.floor(deadline - performance.now());
        if (expired || value < 1) throw new Error(`${name} collection timed out.`);
        return value;
      };
      const work =
        driver === "pgsql"
          ? runInTransaction(
              async () => {
                await db.unsafe("SELECT set_config('statement_timeout', $1, true)", [
                  `${remaining()}ms`,
                ]);
                await db.unsafe("SET TRANSACTION READ ONLY");
                remaining();
                const result = await collect(remaining);
                remaining();
                return result;
              },
              { acquisitionSignal: acquisition.signal },
            )
          : (async () => {
              if (!pool.observeReadOnly)
                throw new Error(
                  `${name} require Postgres or an interruptible SQLite/MySQL adapter.`,
                );
              return pool.observeReadOnly(
                async (connection) =>
                  await runWithDatabaseConnection(connection, async () => {
                    remaining();
                    const result = await collect(remaining);
                    remaining();
                    return result;
                  }),
                { signal: acquisition.signal, timeoutMs: remaining() },
              );
            })();
      active = work;
      void work
        .finally(() => {
          if (active === work) active = undefined;
        })
        .catch(() => {});
      try {
        return await Promise.race([
          work,
          new Promise<never>((_, reject) => {
            timer = setTimeout(() => {
              expired = true;
              const error = new Error(`${name} collection timed out.`);
              acquisition.abort(error);
              reject(error);
            }, timeoutMs);
          }),
        ]);
      } finally {
        if (timer !== undefined) clearTimeout(timer);
      }
    },
    async close() {
      closed = true;
      await active?.catch(() => {});
    },
  };
}

export { createReadOnlyCollector };
