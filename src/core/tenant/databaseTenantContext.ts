import { getDefaultDatabasePool } from "@getstrata/core/database/defaultConnection";
import {
  getActiveDatabaseConnection,
  hasActiveDatabaseConnection,
  runWithDatabaseConnection,
} from "../database/connectionContext";
import { runInTransaction } from "../database/transaction";
import {
  commitOrRollbackScope,
  runWithTransactionScope,
  settleTransaction,
} from "../database/transactionControl";
import { runWithDeferredModelEvents } from "../events/deferredModelEvents";
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

function stringifyBypassIdentifier(identifier: string | number): string {
  if (typeof identifier === "number") {
    return String(identifier);
  }
  return identifier.trim();
}

async function applyIdentifierToTransaction(
  transaction: TransactionHandle,
  identifier: string | number,
): Promise<void> {
  await transaction.unsafe(`SELECT set_config('app.bypass_identifier', $1, true)`, [
    stringifyBypassIdentifier(identifier),
  ]);
}

function assertBypassIdentifier(identifier: string | number): void {
  if (typeof identifier === "number") {
    if (!Number.isInteger(identifier) || identifier <= 0) {
      throw new Error("RLS bypass requires a caller-supplied identifier that pins the row.");
    }
    return;
  }
  if (typeof identifier === "string" && identifier.trim() !== "") {
    return;
  }
  throw new Error("RLS bypass requires a caller-supplied identifier that pins the row.");
}

async function runWithScopedTenantTransaction<T>(
  apply: (transaction: TransactionHandle) => Promise<void>,
  callback: () => T | Promise<T>,
): Promise<T> {
  if (!isRlsTenancy()) {
    return await callback();
  }

  if (hasActiveDatabaseConnection()) {
    const connection = getActiveDatabaseConnection(getDefaultDatabasePool());
    return await runInTransaction(async () => {
      const [previous] = await connection.unsafe<{
        tenant_id: string | null;
        bypass_rls: string | null;
        bypass_identifier: string | null;
      }>(`SELECT current_setting('app.tenant_id', true) AS tenant_id,
        current_setting('app.bypass_rls', true) AS bypass_rls,
        current_setting('app.bypass_identifier', true) AS bypass_identifier`);
      await apply(connection);
      const result = await callback();
      await connection.unsafe(
        `SELECT set_config('app.tenant_id', $1, true),
        set_config('app.bypass_rls', $2, true), set_config('app.bypass_identifier', $3, true)`,
        [previous?.tenant_id ?? "", previous?.bypass_rls ?? "", previous?.bypass_identifier ?? ""],
      );
      return result;
    });
  }

  const pool = getDefaultDatabasePool();
  const begin = pool.begin;
  if (typeof begin !== "function") {
    throw new Error(
      "RLS migration bypass requires a pool that supports begin(). Session-scoped set_config is not used on pooled connections.",
    );
  }

  return await settleTransaction(() =>
    runWithDeferredModelEvents(async () => {
      return await begin.bind(pool)(async (transaction) => {
        await apply(transaction);
        return await runWithDatabaseConnection(transaction, () =>
          runWithTransactionScope(async () => commitOrRollbackScope(await callback())),
        );
      });
    }),
  );
}

async function runWithMigrationBypass<T>(callback: () => T | Promise<T>): Promise<T> {
  return await runWithScopedTenantTransaction(
    (transaction) => applyBypassToTransaction(transaction, true),
    callback,
  );
}

async function runWithMigrationBypassForIdentifier<T>(
  identifier: string | number,
  callback: () => T | Promise<T>,
): Promise<T> {
  assertBypassIdentifier(identifier);
  return await runWithScopedTenantTransaction(
    (transaction) => applyIdentifierToTransaction(transaction, identifier),
    callback,
  );
}

export {
  runWithMigrationBypass,
  runWithMigrationBypassForIdentifier,
  runWithScopedTenantTransaction,
};
