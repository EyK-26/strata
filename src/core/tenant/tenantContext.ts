import { createAsyncContextStore } from "../runtime/asyncContextStore";

type TenantContext = {
  id: number;
  slug: string;
  plan: "free" | "pro" | "enterprise";
  region: "eu" | "us" | "apac";
};

const tenantContext = createAsyncContextStore<TenantContext>("@getstrata/tenantContext");

function runWithTenant<T>(tenant: TenantContext, callback: () => T | Promise<T>): T | Promise<T> {
  return tenantContext.run(tenant, callback);
}

function currentTenant(): TenantContext | null {
  return tenantContext.getStore() ?? null;
}

function currentTenantId(): number {
  const tenant = currentTenant();
  if (!tenant) {
    throw new Error("Tenant context is required.");
  }
  return tenant.id;
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

export type { TenantContext };
export { currentTenant, currentTenantId, rateLimitMultiplierForPlan, runWithTenant, tenantContext };
