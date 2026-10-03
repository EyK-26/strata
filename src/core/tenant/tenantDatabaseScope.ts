import { getDefaultDatabasePool } from "@getstrata/core/database/defaultConnection";
import {
  getActiveDatabaseConnection,
  hasActiveDatabaseConnection,
  runWithDatabaseConnection,
} from "../database/connectionContext";
import {
  commitOrRollbackScope,
  runWithTransactionScope,
  settleTransaction,
} from "../database/transactionControl";
import { runWithDeferredModelEvents } from "../events/deferredModelEvents";
import { isRlsTenancy, isTenancyEnabled } from "./tenancyConfig";
import { currentTenant, runWithTenant, type TenantContext } from "./tenantContext";

type TransactionHandle = {
  unsafe(query: string, params?: readonly unknown[]): Promise<unknown[]>;
  savepoint?<T>(callback: (savepoint: TransactionHandle) => Promise<T>): Promise<T>;
};

type TenantSession = {
  tenantId: string;
  bypassRls: string;
};

async function applyTenantContextToTransaction(
  transaction: TransactionHandle,
  tenantId: number,
): Promise<void> {
  await transaction.unsafe(`SELECT set_config('app.tenant_id', $1, true)`, [String(tenantId)]);
  await transaction.unsafe(`SELECT set_config('app.bypass_rls', $1, true)`, ["false"]);
}

async function readTenantSession(transaction: TransactionHandle): Promise<TenantSession> {
  const rows = await transaction.unsafe<{
    tenant_id: string | null;
    bypass_rls: string | null;
  }>(
    "SELECT current_setting('app.tenant_id', true) AS tenant_id, current_setting('app.bypass_rls', true) AS bypass_rls",
  );
  const row = rows[0];
  return {
    tenantId: row?.tenant_id ?? "",
    bypassRls: row?.bypass_rls ?? "false",
  };
}

async function restoreTenantSession(
  transaction: TransactionHandle,
  previous: TenantSession,
): Promise<void> {
  await transaction.unsafe(`SELECT set_config('app.tenant_id', $1, true)`, [previous.tenantId]);
  await transaction.unsafe(`SELECT set_config('app.bypass_rls', $1, true)`, [previous.bypassRls]);
}

async function runScopedTenantWork<T>(callback: () => T | Promise<T>): Promise<T> {
  return await runWithTransactionScope(async () => {
    const result = await callback();
    return await commitOrRollbackScope(result);
  });
}

async function runNestedTenantDatabase<T>(
  active: TransactionHandle,
  tenant: TenantContext,
  callback: () => T | Promise<T>,
): Promise<T> {
  const previous = await readTenantSession(active);
  try {
    await applyTenantContextToTransaction(active, tenant.id);
    const savepoint = active.savepoint?.bind(active);
    if (typeof savepoint !== "function") {
      return await runWithTenant(tenant, () => runScopedTenantWork(callback));
    }

    return await settleTransaction(() =>
      runWithDeferredModelEvents(async () => {
        return await savepoint(async (nested) => {
          return await runWithDatabaseConnection(nested, async () => {
            return await runWithTenant(tenant, () => runScopedTenantWork(callback));
          });
        });
      }),
    );
  } finally {
    await restoreTenantSession(active, previous);
  }
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
    return await runNestedTenantDatabase(activeConnection, tenant, callback);
  }

  const pool = getDefaultDatabasePool();
  const begin = pool.begin;
  if (typeof begin !== "function") {
    throw new Error(
      "RLS tenant scope requires a pool that supports begin(). Session-scoped set_config is not used on pooled connections.",
    );
  }

  const start = begin.bind(pool);
  return await settleTransaction(() =>
    runWithDeferredModelEvents(async () => {
      return await start(async (transaction) => {
        await applyTenantContextToTransaction(transaction, tenant.id);

        return await runWithDatabaseConnection(transaction, async () => {
          return await runWithTenant(tenant, () => runScopedTenantWork(callback));
        });
      });
    }),
  );
}

function isInsideTenantDatabaseScope(tenantId = currentTenant()?.id): boolean {
  return hasActiveDatabaseConnection() && currentTenant()?.id === tenantId;
}

export { applyTenantContextToTransaction, isInsideTenantDatabaseScope, runWithTenantDatabase };
