import { getDefaultDatabasePool } from "@getstrata/core/database/defaultConnection";
import { runWithDatabaseConnection } from "../database/connectionContext";
import { isRlsTenancy } from "./tenancyConfig";

type TransactionHandle = {
  unsafe(query: string, params?: readonly unknown[]): Promise<unknown[]>;
};

async function applyBypassToTransaction(
  transaction: TransactionHandle,
  bypass: boolean,
): Promise<void> {
  await transaction.unsafe(`SELECT set_config('app.bypass_rls', $1, true)`, [
    bypass ? "true" : "false",
  ]);
}

async function runWithMigrationBypass<T>(callback: () => T | Promise<T>): Promise<T> {
  if (!isRlsTenancy()) {
    return await callback();
  }

  const pool = getDefaultDatabasePool();
  if (typeof pool.begin !== "function") {
    throw new Error(
      "RLS migration bypass requires a pool that supports begin(). Session-scoped set_config is not used on pooled connections.",
    );
  }

  return await pool.begin(async (transaction) => {
    await applyBypassToTransaction(transaction, true);
    return await runWithDatabaseConnection(transaction, callback);
  });
}

export { runWithMigrationBypass };
