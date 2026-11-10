import { mapDatabaseError } from "@getstrata/core/database/errors";
import type { ExecutionContext } from "../contracts/application";
import type { ExecutionOperations } from "../contracts/executionOperations";
import type { OwnedExecution } from "../contracts/executionOwnership";
import type { SqlStatement, TransactionOptions } from "./driverPorts";
import type { DatabaseManager } from "./manager";
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
): DatabaseSession {
  const transactions = new TransactionRuntime(context, operations, ownership);
  const select = (name?: string): DatabaseSession => {
    const pool = manager.connection(name);
    return Object.freeze({
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
        return select(connection);
      },
    });
  };
  // Factories initialize before body admission; selection itself is resource-free.
  return select();
}

export { createDatabaseSession };
