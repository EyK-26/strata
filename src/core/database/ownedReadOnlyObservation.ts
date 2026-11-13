import { CORE_EXECUTION_OPERATIONS_TOKEN } from "@getstrata/core/contracts/executionOperations";
import { CORE_EXECUTION_OWNERSHIP_TOKEN } from "@getstrata/core/contracts/executionOwnership";
import { DATABASE_SESSION_TOKEN } from "@getstrata/core/database/tokens";
import { assertNoOwnedTransaction, DATABASE_OWNERSHIP_TOKEN } from "#strata-orm-internal";
import { copyApplicationConfig } from "../config/configSnapshot";
import type { Application } from "../contracts/application";
import { createScopedPolicy } from "../tenant/scopedDatabasePolicy";
import type { DatabaseConnectionOptions, SqlStatement } from "./driverPorts";
import { observeIsolatedReadOnly } from "./isolatedReadOnlyObservation";
import { sqliteFilename } from "./rawSqlite";
import { dialectFor, type SqlDialect } from "./sqlDialects";
import { snapshotStatement } from "./transactionSession";

interface ReadOnlyObservationExecutor {
  readonly dialect: SqlDialect;
  execute<Row>(statement: SqlStatement): Promise<readonly Row[]>;
}
type ReadOnlyObservation = <T>(
  timeoutMs: number,
  work: (database: ReadOnlyObservationExecutor, remaining: () => number) => Promise<T>,
) => Promise<T>;

interface ReadOnlyObservationOptions {
  /** Trusted platform collector admission; never derived from request input. */
  readonly postgresPolicy?: "bypass";
}

/** Compose from the same immutable connection selection as the application's bindings. */
function createOwnedReadOnlyObservation(
  application: Application,
  connection: string,
  options: DatabaseConnectionOptions,
  observationOptions: ReadOnlyObservationOptions = {},
): ReadOnlyObservation {
  if (!connection.trim()) throw new TypeError("Read-only observation needs a connection name.");
  const configured = copyApplicationConfig(options) as DatabaseConnectionOptions;
  const dialect = dialectFor(configured.driver);
  const postgresPolicy = observationOptions.postgresPolicy;
  if (postgresPolicy !== undefined && postgresPolicy !== "bypass")
    throw new TypeError("Unsupported PostgreSQL observation policy.");
  return <T>(
    timeoutMs: number,
    work: (database: ReadOnlyObservationExecutor, remaining: () => number) => Promise<T>,
  ): Promise<T> => {
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 5000)
      throw new TypeError("SQL observation timeout must be between 1 and 5000 milliseconds.");
    if (typeof work !== "function") throw new TypeError("SQL observation requires a callback.");
    const deadline = performance.now() + timeoutMs;
    const timeout = new AbortController();
    const timeoutError = new Error("SQL observation timed out.");
    const timer = setTimeout(() => timeout.abort(timeoutError), timeoutMs);
    const remaining = () => {
      timeout.signal.throwIfAborted();
      const value = Math.floor(deadline - performance.now());
      if (value < 1) throw timeoutError;
      return value;
    };
    const actual = application.run(
      {
        kind: "command",
        actor: { kind: "system", policy: "metrics.read-only" },
        signal: timeout.signal,
      },
      async (scope) => {
        const owner = scope.resolve(DATABASE_OWNERSHIP_TOKEN);
        const configuredPool = owner.connections[connection];
        if (!configuredPool) throw new TypeError("Unknown read-only observation connection.");
        assertNoOwnedTransaction(
          { app: owner.app, configuredPool },
          "SQL observations require an independent transaction.",
        );
        const database = scope.resolve(DATABASE_SESSION_TOKEN).connection(connection);
        if (database.dialect.driver !== configured.driver)
          throw new TypeError("Read-only observation driver differs from the selected connection.");
        const ownership = scope.resolve(CORE_EXECUTION_OWNERSHIP_TOKEN);
        const operations = scope.resolve(CORE_EXECUTION_OPERATIONS_TOKEN);
        if (configured.driver === "pgsql") {
          return database.transaction(
            async (child) => {
              await child.execute({
                text: "SELECT set_config('statement_timeout', $1, true)",
                params: [`${remaining()}ms`],
              });
              await child.execute({ text: "SET TRANSACTION READ ONLY", params: [] });
              const observe = (selected: typeof child) =>
                work(
                  Object.freeze({ dialect: selected.dialect, execute: selected.execute }),
                  remaining,
                );
              const result =
                postgresPolicy === "bypass"
                  ? await createScopedPolicy(ownership, scope.context, database).run(
                      child,
                      { kind: "bypass" },
                      observe,
                    )
                  : await observe(child);
              remaining();
              return result;
            },
            { acquisitionSignal: scope.context.signal },
          );
        }
        const profile =
          configured.driver === "sqlite"
            ? { driver: "sqlite" as const, filename: sqliteFilename(configured.filename) }
            : {
                driver: "mysql" as const,
                url: configured.url,
                module: import.meta.resolve("mysql2/promise"),
              };
        if (profile.driver === "sqlite" && profile.filename === ":memory:")
          throw new TypeError("SQL observations require file-backed SQLite.");
        // The native observer may reject its waiter on timeout. The inner node remains
        // owned by this run until the actual callback subtree settles; child exit is
        // separately awaited by the existing observer's finally block.
        return observeIsolatedReadOnly(
          profile,
          async (native) => {
            const joined = await ownership.joined(async () => {
              const executor: ReadOnlyObservationExecutor = Object.freeze({
                dialect,
                execute: <Row>(input: SqlStatement) => {
                  try {
                    operations.assertActive();
                    const statement = snapshotStatement(input);
                    return operations.operation(async () => {
                      remaining();
                      return native.unsafe<Row>(statement.text, statement.params);
                    });
                  } catch (error) {
                    const rejected = Promise.reject<readonly Row[]>(error);
                    void rejected.catch(() => {});
                    return rejected;
                  }
                },
              });
              remaining();
              const result = await work(executor, remaining);
              remaining();
              return result;
            });
            if (!joined.body.ok) throw joined.body.error;
            return joined.body.value;
          },
          { signal: scope.context.signal, timeoutMs: remaining() },
        );
      },
    );
    void actual.finally(() => clearTimeout(timer)).catch(() => {});
    return actual;
  };
}

export type { ReadOnlyObservation, ReadOnlyObservationExecutor, ReadOnlyObservationOptions };
export { createOwnedReadOnlyObservation };
