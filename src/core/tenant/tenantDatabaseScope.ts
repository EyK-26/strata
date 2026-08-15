import {
  getActiveDatabaseConnection,
  hasActiveDatabaseConnection,
  runWithDatabaseConnection,
} from "../database/connectionContext";
import { getDefaultDatabasePool } from "../database/defaultConnection";
import { currentTenant, runWithTenant, type TenantContext } from "./tenantContext";

type TransactionHandle = {
  unsafe(query: string, params?: readonly unknown[]): Promise<unknown[]>;
};

async function applyTenantContextToTransaction(
  transaction: TransactionHandle,
  tenantId: number,
): Promise<void> {
  await transaction.unsafe(`SELECT set_config('app.tenant_id', $1, true)`, [String(tenantId)]);
  await transaction.unsafe(`SELECT set_config('app.bypass_rls', $1, true)`, ["false"]);
}

async function runWithTenantDatabase<T>(
  tenant: TenantContext,
  callback: () => T | Promise<T>,
): Promise<T> {
  if (hasActiveDatabaseConnection()) {
    const activeConnection = getActiveDatabaseConnection(getDefaultDatabasePool());
    await applyTenantContextToTransaction(activeConnection, tenant.id);

    return await runWithTenant(tenant, callback);
  }

  return await getDefaultDatabasePool().begin!(async (transaction) => {
    await applyTenantContextToTransaction(transaction, tenant.id);

    return await runWithDatabaseConnection(transaction, async () => {
      return await runWithTenant(tenant, callback);
    });
  });
}

function isInsideTenantDatabaseScope(tenantId = currentTenant()?.id): boolean {
  return hasActiveDatabaseConnection() && currentTenant()?.id === tenantId;
}

export { applyTenantContextToTransaction, isInsideTenantDatabaseScope, runWithTenantDatabase };
