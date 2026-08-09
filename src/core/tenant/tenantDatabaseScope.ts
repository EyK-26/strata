import { getDatabase } from "../../db/connection";
import { runWithDatabaseConnection } from "../database/connectionContext";
import { runWithTenant, type TenantContext } from "./tenantContext";

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
  return await getDatabase().begin(async (transaction) => {
    await applyTenantContextToTransaction(transaction, tenant.id);

    return await runWithDatabaseConnection(transaction, async () => {
      return await runWithTenant(tenant, callback);
    });
  });
}

export { applyTenantContextToTransaction, runWithTenantDatabase };
