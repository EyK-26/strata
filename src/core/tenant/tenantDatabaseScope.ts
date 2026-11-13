import type { DatabaseSession, TransactionSession } from "../database/session";
import type { ScopedPolicy } from "./scopedDatabasePolicy";
import { runWithTenant, type TenantContext } from "./tenantContext";

export function runWithTenantDatabase<T>(
  selected: DatabaseSession | TransactionSession,
  policy: ScopedPolicy,
  tenant: TenantContext,
  callback: (child: TransactionSession) => T | Promise<T>,
): Promise<T> {
  return policy.run(selected, { kind: "tenant", tenantId: tenant.id }, (child) =>
    runWithTenant(tenant, () => callback(child)),
  );
}
