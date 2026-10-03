import { getDefaultDatabasePool } from "@getstrata/core/database/defaultConnection";
import {
  getActiveDatabaseConnection,
  hasActiveDatabaseConnection,
  runWithDatabaseConnection,
} from "../database/connectionContext";
import { runWithDeferredModelEvents } from "../events/deferredModelEvents";
import { isRlsTenancy, isTenancyEnabled } from "./tenancyConfig";
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
  if (!isTenancyEnabled() || !isRlsTenancy()) {
    return await runWithTenant(tenant, callback);
  }

  if (hasActiveDatabaseConnection()) {
    const activeConnection = getActiveDatabaseConnection(getDefaultDatabasePool());
    await applyTenantContextToTransaction(activeConnection, tenant.id);

    return await runWithTenant(tenant, callback);
  }

  const pool = getDefaultDatabasePool();
  const begin = pool.begin;
  if (typeof begin !== "function") {
    throw new Error(
      "RLS tenant scope requires a pool that supports begin(). Session-scoped set_config is not used on pooled connections.",
    );
  }

  return await runWithDeferredModelEvents(async () => {
    return await begin(async (transaction) => {
      await applyTenantContextToTransaction(transaction, tenant.id);

      return await runWithDatabaseConnection(transaction, async () => {
        return await runWithTenant(tenant, callback);
      });
    });
  });
}

function isInsideTenantDatabaseScope(tenantId = currentTenant()?.id): boolean {
  return hasActiveDatabaseConnection() && currentTenant()?.id === tenantId;
}

export { applyTenantContextToTransaction, isInsideTenantDatabaseScope, runWithTenantDatabase };
