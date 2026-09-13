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

  const pool = getDefaultDatabasePool();
  if (typeof pool.begin !== "function") {
    throw new Error(
      "RLS migration bypass requires a pool that supports begin(). Session-scoped set_config is not used on pooled connections.",
    );
  }

  return await pool.begin(async (transaction) => {
    await apply(transaction);
    return await runWithDatabaseConnection(transaction, callback);
  });
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

export { runWithMigrationBypass, runWithMigrationBypassForIdentifier };
