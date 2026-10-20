import { afterCommit, runWithDeferredModelEvents } from "../events/deferredModelEvents.ts";
import { createAsyncContextStore } from "../runtime/asyncContextStore.ts";
import {
  observeTransactionAcquisition,
  type TransactionAcquisitionMetrics,
} from "./acquisitionMetrics.ts";
import { createDatabaseConnection, type UnsafeQueryable } from "./connection.ts";
import {
  getActiveDatabaseConnection,
  hasActiveDatabaseConnection,
  runWithDatabaseConnection,
} from "./connectionContext.ts";
import type { DatabaseConnection } from "./connectionContracts.ts";
import { resolveRepositoryConnection } from "./repositoryConnection.ts";
import {
  commitOrRollbackScope,
  hasActiveTransaction,
  requestTransactionRollback,
  runWithTransactionScope,
  settleTransaction,
} from "./transactionControl.ts";

type TransactionFrame = { connection: UnsafeQueryable; childActive: boolean };
const transactionFrame = createAsyncContextStore<TransactionFrame>("@getstrata/transactionFrame");
const outerFrames = new WeakMap<UnsafeQueryable, TransactionFrame>();
const transactionRoots = new WeakMap<UnsafeQueryable, DatabaseConnection>();
const transactionAliases = new WeakMap<DatabaseConnection, UnsafeQueryable>();

function scopedConnection(source: UnsafeQueryable): DatabaseConnection {
  const connection = createDatabaseConnection(source);
  transactionAliases.set(connection, source);
  return connection;
}

/** Recognizes the callback handle without admitting an unrelated pool. */
function isActiveTransactionConnection(connection: DatabaseConnection): boolean {
  if (!hasActiveTransaction() || !hasActiveDatabaseConnection()) return false;
  const active = getActiveDatabaseConnection(connection);
  return connection === active || transactionAliases.get(connection) === active;
}

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
              commitOrRollbackScope(await operation(scopedConnection(connection))),
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

interface TransactionOptions {
  /** Explicit root pool for injected repositories; cannot switch an active transaction's owner. */
  connection?: DatabaseConnection;
  /** Cancel admission/pool checkout only. Does not cancel SQL or an admitted business callback. */
  acquisitionSignal?: AbortSignal;
  /** Observe native checkout only; requires a reserve-capable adapter. */
  acquisitionMetrics?: TransactionAcquisitionMetrics;
}
async function runInTransaction<TValue>(
  operation: (connection: DatabaseConnection) => Promise<TValue>,
  options: TransactionOptions = {},
): Promise<TValue> {
  const signal = options.acquisitionSignal;
  signal?.throwIfAborted();
  const admittedOperation = (connection: DatabaseConnection): Promise<TValue> => {
    signal?.throwIfAborted();
    return operation(connection);
  };
  const pool = options.connection ?? resolveRepositoryConnection();

  if (hasActiveDatabaseConnection()) {
    const active = getActiveDatabaseConnection(pool);
    if (
      options.connection &&
      options.connection !== active &&
      options.connection !== transactionRoots.get(active) &&
      transactionAliases.get(options.connection) !== active
    )
      throw new Error("Cannot switch database connections within an active transaction.");
    return await runInSavepoint(active, admittedOperation);
  }

  if (!supportsTransactions(pool)) {
    throw new Error(
      "Active database connection does not support transactions. Bind a client with begin() via bindDatabaseConnection.",
    );
  }

  return await settleTransaction(() =>
    runWithDeferredModelEvents(async () => {
      let reserved: (DatabaseConnection & { release(): void | Promise<void> }) | undefined;
      if (signal || options.acquisitionMetrics) {
        if (!pool.reserve)
          throw new Error(
            signal
              ? "Active database connection does not support cancellable transaction acquisition."
              : "Active database connection does not support observable transaction acquisition.",
          );
        const reserve = pool.reserve.bind(pool);
        reserved = options.acquisitionMetrics
          ? await observeTransactionAcquisition(
              options.acquisitionMetrics,
              () => reserve({ signal }),
              signal,
            )
          : await reserve({ signal });
      }
      const connection = reserved ?? pool;
      try {
        signal?.throwIfAborted();
        if (!supportsTransactions(connection))
          throw new Error("Reserved database connection does not support transactions.");
        // Native drivers can invoke queued callbacks outside the caller's async resource.
        return await connection.begin(
          AsyncLocalStorage.bind(async (transaction) => {
            transactionRoots.set(transaction, pool);
            return await runWithDatabaseConnection(transaction, () =>
              transactionFrame.run({ connection: transaction, childActive: false }, () =>
                runWithTransactionScope(async () =>
                  commitOrRollbackScope(await admittedOperation(scopedConnection(transaction))),
                ),
              ),
            );
          }),
        );
      } finally {
        // Release before deferred observers flush; reentrant listeners may need this slot.
        await reserved?.release();
      }
    }),
  );
}

export type {
  TransactionAcquisitionMetrics,
  TransactionAcquisitionSnapshot,
} from "./acquisitionMetrics.ts";
export {
  createTransactionAcquisitionMetrics,
  renderTransactionAcquisitionMetrics,
} from "./acquisitionMetrics.ts";
export type { TransactionOptions };
/** Register process-local work for the successful outermost commit. Awaiting
 * registration does not execute it early inside an active transaction. Outside
 * a managed transaction it runs immediately. Failure propagates after commit;
 * committed writes cannot roll back. Use the SQL outbox for durable delivery. */
export {
  afterCommit,
  hasActiveTransaction,
  isActiveTransactionConnection,
  requestTransactionRollback,
  runInTransaction,
};

import { AsyncLocalStorage } from "node:async_hooks";
