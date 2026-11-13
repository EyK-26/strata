import { mapDatabaseError } from "@getstrata/core/database/errors";
import type { ExecutionContext } from "../contracts/application";
import type { ExecutionOperations } from "../contracts/executionOperations";
import type { OwnedExecution } from "../contracts/executionOwnership";
import type { SqlStatement, TransactionOptions } from "./driverPorts";
import type { DatabaseManager } from "./manager";
import { createBoundRegistryFactory, type PreparedRegistry } from "./modelRegistry";
import type { DatabaseSession } from "./session";
import {
  snapshotStatement,
  TransactionRuntime,
  type TransactionSession,
} from "./transactionSession";

function rejected<T>(error: unknown): Promise<T> {
  const promise = Promise.reject<T>(error);
  void promise.catch(() => {});
  return promise;
}

/** Execution value facade; native pool disposal belongs exclusively to the application. */
function createDatabaseSession(
  manager: DatabaseManager,
  context: ExecutionContext,
  operations: ExecutionOperations,
  ownership: OwnedExecution,
  prepared: PreparedRegistry,
): DatabaseSession {
  const factory = createBoundRegistryFactory(prepared, context, ownership, (pool) =>
    manager.configuredPool(pool),
  );
  const transactions = new TransactionRuntime(
    context,
    operations,
    ownership,
    (session, authority) => factory.attach(session, authority),
    (pool) => selectPool(pool),
    (pool) => Object.freeze({ app: prepared.app, configuredPool: manager.configuredPool(pool) }),
  );
  const cache = new Map<ReturnType<DatabaseManager["connection"]>, DatabaseSession>();
  const selectPool = (pool: ReturnType<DatabaseManager["connection"]>): DatabaseSession => {
    const existing = cache.get(pool);
    if (existing) return existing;
    let registry: ReturnType<typeof factory.attach>;
    const assertActive = () => transactions.assertOutside();
    const run = <T>(work: () => T | Promise<T>): Promise<T> => {
      try {
        assertActive();
        return operations.operation(() => {
          assertActive();
          return work();
        });
      } catch (error) {
        return rejected(error);
      }
    };
    const session: DatabaseSession = {
      repository: (definition) => registry.repository(definition),
      model: (definition) => registry.model(definition),

      dialect: pool.dialect,
      capabilities: pool.capabilities,
      execute: <Row>(input: SqlStatement): Promise<readonly Row[]> => {
        try {
          transactions.assertOutside();
          const statement = snapshotStatement(input);
          return operations.operation(() => {
            transactions.assertOutside();
            try {
              return Promise.resolve(pool.execute<Row>(statement)).catch((error: unknown) => {
                throw mapDatabaseError(error);
              });
            } catch (error) {
              throw mapDatabaseError(error);
            }
          });
        } catch (error) {
          return rejected(error);
        }
      },
      transaction: <T>(
        work: (tx: TransactionSession) => T | Promise<T>,
        options?: TransactionOptions,
      ) => transactions.run(pool, work, options),
      connection: (connection: string) => {
        transactions.assertOutside();
        return selectPool(manager.connection(connection));
      },
    };
    registry = factory.attach(session, {
      pool,
      branch: session,
      transactional: false,
      assertActive,
      run,
      registerRestore: () => {
        assertActive();
      },
      root: () => session,
    });
    Object.freeze(session);
    cache.set(pool, session);
    return session;
  };
  // Factories initialize before body admission; selection itself is resource-free.
  return selectPool(manager.connection());
}

export { createDatabaseSession };
