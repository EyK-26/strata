import { runWithDeferredModelEvents } from "../events/deferredModelEvents.ts";
import { createAsyncContextStore } from "../runtime/asyncContextStore.ts";
import type { DatabaseConnection } from "./baseRepository.ts";
import { createDatabaseConnection, type UnsafeQueryable } from "./connection.ts";
import {
  getActiveDatabaseConnection,
  hasActiveDatabaseConnection,
  runWithDatabaseConnection,
} from "./connectionContext.ts";
import { resolveRepositoryConnection } from "./repositoryConnection.ts";
import {
  commitOrRollbackScope,
  requestTransactionRollback,
  runWithTransactionScope,
  settleTransaction,
} from "./transactionControl.ts";

type TransactionFrame = { connection: UnsafeQueryable; childActive: boolean };
const transactionFrame = createAsyncContextStore<TransactionFrame>("@getstrata/transactionFrame");
const outerFrames = new WeakMap<UnsafeQueryable, TransactionFrame>();

async function runInSavepoint<TValue>(
  connection: UnsafeQueryable,
  operation: (connection: DatabaseConnection) => Promise<TValue>,
): Promise<TValue> {
  const inherited = transactionFrame.getStore();
  let parent = inherited?.connection === connection ? inherited : outerFrames.get(connection);
  if (!parent) {
    parent = { connection, childActive: false };
    outerFrames.set(connection, parent);
  }
  if (parent.childActive) {
    throw new Error(
      "Concurrent nested transactions on one connection are not supported. Await each transaction before starting the next.",
    );
  }
  parent.childActive = true;
  const name = `strata_${crypto.randomUUID().replaceAll("-", "")}`;
  try {
    return await settleTransaction(() =>
      runWithDeferredModelEvents(async () => {
        await connection.unsafe(`SAVEPOINT ${name}`);
        try {
          const result = await transactionFrame.run({ connection, childActive: false }, () =>
            runWithTransactionScope(async () =>
              commitOrRollbackScope(await operation(createDatabaseConnection(connection))),
            ),
          );
          await connection.unsafe(`RELEASE SAVEPOINT ${name}`);
          return result;
        } catch (error) {
          await connection.unsafe(`ROLLBACK TO SAVEPOINT ${name}`);
          await connection.unsafe(`RELEASE SAVEPOINT ${name}`);
          throw error;
        }
      }),
    );
  } finally {
    parent.childActive = false;
  }
}

type TransactionCapableConnection = DatabaseConnection & {
  begin<TValue>(callback: (transaction: UnsafeQueryable) => Promise<TValue>): Promise<TValue>;
};

function supportsTransactions(
  connection: DatabaseConnection,
): connection is TransactionCapableConnection {
  return typeof (connection as TransactionCapableConnection).begin === "function";
}

async function runInTransaction<TValue>(
  operation: (connection: DatabaseConnection) => Promise<TValue>,
): Promise<TValue> {
  const pool = resolveRepositoryConnection();

  if (hasActiveDatabaseConnection()) {
    return await runInSavepoint(getActiveDatabaseConnection(pool), operation);
  }

  if (!supportsTransactions(pool)) {
    throw new Error(
      "Active database connection does not support transactions. Bind a client with begin() via bindDatabaseConnection.",
    );
  }

  return await settleTransaction(() =>
    runWithDeferredModelEvents(async () => {
      return await pool.begin(async (transaction) => {
        return await runWithDatabaseConnection(transaction, () =>
          transactionFrame.run({ connection: transaction, childActive: false }, () =>
            runWithTransactionScope(async () =>
              commitOrRollbackScope(await operation(createDatabaseConnection(transaction))),
            ),
          ),
        );
      });
    }),
  );
}

export { requestTransactionRollback, runInTransaction };
