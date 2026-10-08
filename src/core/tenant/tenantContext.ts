import { createAsyncContextStore } from "../runtime/asyncContextStore";

type TenantContext = {
  id: number;
  slug: string;
  /** Trusted application data; never inferred from request headers. */
  metadata?: Readonly<Record<string, unknown>>;
  /** Existing application extensions remain opaque to core. */
  [key: string]: unknown;
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

export type { TenantContext };
export { currentTenant, currentTenantId, runWithTenant, tenantContext };
