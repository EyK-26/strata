import { createHash } from "node:crypto";
import db from "../../db/connection";
import { runWithTenant, type TenantContext } from "./tenantContext";

const DEFAULT_TENANT: TenantContext = {
  id: 1,
  slug: "default",
  plan: "enterprise",
};

async function resolveTenant(tenantId: number): Promise<TenantContext | null> {
  const rows = (await db`
    SELECT id, slug, plan
    FROM tenant
    WHERE id = ${tenantId}
    LIMIT 1
  `) as Array<{ id: number; slug: string; plan: TenantContext["plan"] }>;

  const row = rows[0];
  return row ? { id: row.id, slug: row.slug, plan: row.plan } : null;
}

function createTenantMiddleware() {
  return async (request: Request, next: () => Promise<Response>) => {
    const headerValue = request.headers.get("x-tenant-id")?.trim();
    const tenantId = headerValue ? Number.parseInt(headerValue, 10) : DEFAULT_TENANT.id;
    const tenant =
      Number.isInteger(tenantId) && tenantId > 0
        ? (await resolveTenant(tenantId)) ?? DEFAULT_TENANT
        : DEFAULT_TENANT;

    return await runWithTenant(tenant, async () => {
      const response = await next();
      const headers = new Headers(response.headers);
      headers.set("x-tenant-id", String(tenant.id));
      return new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers,
      });
    });
  };
}

function auditChecksum(payload: Record<string, unknown>): string {
  return createHash("sha256").update(JSON.stringify(payload)).digest("hex");
}

export { auditChecksum, createTenantMiddleware, DEFAULT_TENANT, resolveTenant };
