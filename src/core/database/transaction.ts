import { runWithDeferredModelEvents } from "../events/deferredModelEvents.ts";
import type { DatabaseConnection } from "./baseRepository.ts";
import { createDatabaseConnection, type UnsafeQueryable } from "./connection.ts";
import { getActiveDatabaseConnection, hasActiveDatabaseConnection } from "./connectionContext.ts";
import { resolveRepositoryConnection } from "./repositoryConnection.ts";
import {
  commitOrRollbackScope,
  requestTransactionRollback,
  runWithTransactionScope,
  settleTransaction,
} from "./transactionControl.ts";

type TransactionCapableConnection = DatabaseConnection & {
  begin<TValue>(callback: (transaction: UnsafeQueryable) => Promise<TValue>): Promise<TValue>;
};

type SavepointCallback<TValue> = (savepoint: UnsafeQueryable) => Promise<TValue>;

function supportsTransactions(
  connection: DatabaseConnection,
): connection is TransactionCapableConnection {
  return typeof (connection as TransactionCapableConnection).begin === "function";
}

function readActiveSavepoint():
  | (<TValue>(callback: SavepointCallback<TValue>) => Promise<TValue>)
  | null {
  if (!hasActiveDatabaseConnection()) {
    return null;
  }

  const active = getActiveDatabaseConnection(resolveRepositoryConnection());
  const savepoint = (active as { savepoint?: unknown }).savepoint;
  if (typeof savepoint !== "function") {
    return null;
  }

  return savepoint.bind(active) as <TValue>(callback: SavepointCallback<TValue>) => Promise<TValue>;
}

async function runInSavepoint<TValue>(
  savepoint: <TResult>(callback: SavepointCallback<TResult>) => Promise<TResult>,
  operation: (connection: DatabaseConnection) => Promise<TValue>,
): Promise<TValue> {
  return await settleTransaction(() =>
    runWithDeferredModelEvents(async () => {
      return await savepoint(async (transaction) => {
        return await runWithTransactionScope(async () => {
          const result = await operation(createDatabaseConnection(transaction));
          return await commitOrRollbackScope(result);
        });
      });
    }),
  );
}

async function runInTransaction<TValue>(
  operation: (connection: DatabaseConnection) => Promise<TValue>,
): Promise<TValue> {
  const savepoint = readActiveSavepoint();
  if (savepoint) {
    return await runInSavepoint(savepoint, operation);
  }

  const pool = resolveRepositoryConnection();

  if (!supportsTransactions(pool)) {
    throw new Error(
      "Active database connection does not support transactions. Bind a client with begin() via bindDatabaseConnection.",
    );
  }

  const begin = pool.begin.bind(pool);
  return await runInSavepoint(begin, operation);
}

export { requestTransactionRollback, runInTransaction };
