import { createHash } from "node:crypto";
import { isGlobalAdmin } from "@getstrata/core/auth/accessControl";
import { currentAuthUser } from "@getstrata/core/auth/authContext";
import { repositoryConnection as db } from "@getstrata/core/database/repositoryConnection";
import { ForbiddenError, toHttpError } from "@getstrata/core/errors/http";
import { isPublicReadsEnabled } from "@getstrata/core/security/publicReads";
import { runWithMigrationBypass } from "./databaseTenantContext";
import { resolveTenant } from "./resolveTenant";
import { isTenancyEnabled } from "./tenancyConfig";
import { runWithTenant, type TenantContext } from "./tenantContext";
import { runWithTenantDatabase } from "./tenantDatabaseScope";

const DEFAULT_TENANT: TenantContext = {
  id: 1,
  slug: "default",
  plan: "enterprise",
  region: "eu",
};

async function resolveUserTenantId(userId: number): Promise<number> {
  if (!isTenancyEnabled()) {
    return DEFAULT_TENANT.id;
  }

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

        const memberTenant = await resolveTenant(userTenantId);
        if (memberTenant) {
          return memberTenant;
        }

        return DEFAULT_TENANT;
      }

      if (Number.isInteger(parsedHeader) && parsedHeader > 0) {
        const headerTenant = await resolveTenant(parsedHeader);
        if (headerTenant) {
          return headerTenant;
        }

        return DEFAULT_TENANT;
      }

      const adminTenant = await resolveTenant(userTenantId);
      if (adminTenant) {
        return adminTenant;
      }

      return DEFAULT_TENANT;
    }
  }

  const headerTenantId = Number.isInteger(parsedHeader) && parsedHeader > 0 ? parsedHeader : null;
  const tenantId =
    isPublicReadsEnabled() && headerTenantId !== null ? headerTenantId : DEFAULT_TENANT.id;
  const guestTenant = await resolveTenant(tenantId);
  if (guestTenant) {
    return guestTenant;
  }

  return DEFAULT_TENANT;
}

function createTenantMiddleware() {
  return async (request: Request, next: () => Promise<Response>) => {
    const pathname = new URL(request.url).pathname;

    if (pathname.startsWith("/scim/")) {
      return await next();
    }

    if (!isTenancyEnabled()) {
      return await runWithTenant(DEFAULT_TENANT, next);
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
      const httpError = toHttpError(error);

      if (httpError) {
        return Response.json({ error: httpError.message }, { status: httpError.status });
      }

      throw error;
    }
  };
}

export { auditChecksum, createTenantMiddleware, DEFAULT_TENANT, resolveUserTenantId };
