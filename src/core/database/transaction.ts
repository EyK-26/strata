import type { DatabaseConnection } from "./baseRepository.ts";
import { createDatabaseConnection, type UnsafeQueryable } from "./connection.ts";
import { resolveRepositoryConnection } from "./repositoryConnection.ts";

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

  if (!supportsTransactions(pool)) {
    throw new Error(
      "Active database connection does not support transactions. Bind a client with begin() via bindDatabaseConnection.",
    );
  }

  return await pool.begin(async (transaction) => {
    return await operation(createDatabaseConnection(transaction));
  });
}

export { runInTransaction };
