import { AsyncLocalStorage } from "node:async_hooks";

type TenantContext = {
  id: number;
  slug: string;
  plan: "free" | "pro" | "enterprise";
};

const tenantContext = new AsyncLocalStorage<TenantContext>();

function runWithTenant<T>(tenant: TenantContext, callback: () => T | Promise<T>): T | Promise<T> {
  return tenantContext.run(tenant, callback);
}

function currentTenant(): TenantContext | null {
  return tenantContext.getStore() ?? null;
}

function currentTenantId(): number {
  return currentTenant()?.id ?? 1;
}

function rateLimitMultiplierForPlan(plan: TenantContext["plan"]): number {
  switch (plan) {
    case "enterprise":
      return 4;
    case "pro":
      return 2;
    default:
      return 1;
  }
}

export {
  currentTenant,
  currentTenantId,
  rateLimitMultiplierForPlan,
  runWithTenant,
  tenantContext,
};
export type { TenantContext };
