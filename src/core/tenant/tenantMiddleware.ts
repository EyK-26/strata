import { createHash } from "node:crypto";
import db from "../../db/connection";
import { isGlobalAdmin } from "../auth/accessControl";
import { currentAuthUser } from "../auth/authContext";
import { ForbiddenError, HttpError } from "../errors/http";
import { runWithMigrationBypass } from "./databaseTenantContext";
import { resolveTenant } from "./resolveTenant";
import type { TenantContext } from "./tenantContext";
import { runWithTenantDatabase } from "./tenantDatabaseScope";

const DEFAULT_TENANT: TenantContext = {
  id: 1,
  slug: "default",
  plan: "enterprise",
  region: "eu",
};

async function resolveUserTenantId(userId: number): Promise<number> {
  return await runWithMigrationBypass(async () => {
    const rows = (await db`
      SELECT tenant_id
      FROM users
      WHERE id = ${userId}
      LIMIT 1
    `) as Array<{ tenant_id: number }>;

    return rows[0]?.tenant_id ?? DEFAULT_TENANT.id;
  });
}

function auditChecksum(payload: Record<string, unknown>): string {
  return createHash("sha256").update(JSON.stringify(payload)).digest("hex");
}

async function resolveTenantForRequest(request: Request): Promise<TenantContext> {
  const user = currentAuthUser();
  const headerValue = request.headers.get("x-tenant-id")?.trim();
  const parsedHeader =
    headerValue !== undefined && headerValue.length > 0
      ? Number.parseInt(headerValue, 10)
      : Number.NaN;

  if (user) {
    const userId = typeof user.id === "number" ? user.id : Number.parseInt(String(user.id), 10);

    if (Number.isInteger(userId) && userId > 0) {
      const userTenantId = await resolveUserTenantId(userId);

      if (!isGlobalAdmin(user)) {
        if (Number.isInteger(parsedHeader) && parsedHeader > 0 && parsedHeader !== userTenantId) {
          throw new ForbiddenError("Tenant header does not match your account.");
        }

        return (await resolveTenant(userTenantId)) ?? DEFAULT_TENANT;
      }

      if (Number.isInteger(parsedHeader) && parsedHeader > 0) {
        return (await resolveTenant(parsedHeader)) ?? DEFAULT_TENANT;
      }

      return (await resolveTenant(userTenantId)) ?? DEFAULT_TENANT;
    }
  }

  const tenantId =
    Number.isInteger(parsedHeader) && parsedHeader > 0 ? parsedHeader : DEFAULT_TENANT.id;
  return (await resolveTenant(tenantId)) ?? DEFAULT_TENANT;
}

function createTenantMiddleware() {
  return async (request: Request, next: () => Promise<Response>) => {
    const pathname = new URL(request.url).pathname;

    if (pathname.startsWith("/scim/")) {
      return await next();
    }

    try {
      const tenant = await resolveTenantForRequest(request);

      return await runWithTenantDatabase(tenant, async () => {
        const response = await next();
        const headers = new Headers(response.headers);
        headers.set("x-tenant-id", String(tenant.id));
        headers.set("x-tenant-region", tenant.region);
        return new Response(response.body, {
          status: response.status,
          statusText: response.statusText,
          headers,
        });
      });
    } catch (error) {
      if (error instanceof HttpError) {
        return Response.json({ error: error.message }, { status: error.status });
      }

      throw error;
    }
  };
}

export { auditChecksum, createTenantMiddleware, DEFAULT_TENANT, resolveUserTenantId };
