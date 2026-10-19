import { createHash } from "node:crypto";
import { isGlobalAdmin } from "@getstrata/core/auth/accessControl";
import { currentAuthUser } from "@getstrata/core/auth/authContext";
import { ForbiddenError, toHttpError } from "@getstrata/core/errors/http";
import { privateJsonResponse } from "@getstrata/core/http/response";
import { isProductionEnv } from "@getstrata/core/runtime/appEnv";
import { BaseRepository } from "../database/baseRepository";
import { defineTable } from "../database/table";
import { runWithMigrationBypassForIdentifier } from "./databaseTenantContext";
import { createPublicTenantSelector, type PublicTenancyOptions } from "./publicTenantHost";
import { resolveTenant } from "./resolveTenant";
import { isTenancyEnabled } from "./tenancyConfig";
import { runWithTenant, type TenantContext } from "./tenantContext";
import { runWithTenantDatabase } from "./tenantDatabaseScope";

const DEFAULT_TENANT: TenantContext = {
  id: 1,
  slug: "default",
};

const userTenants = new BaseRepository(
  defineTable<{ id: number; tenant_id: number }, "id">({
    name: "users",
    primaryKey: "id",
    columns: ["id", "tenant_id"],
  }),
);

async function resolveUserTenantId(userId: number): Promise<number> {
  if (!isTenancyEnabled()) {
    return DEFAULT_TENANT.id;
  }

  return await runWithMigrationBypassForIdentifier(userId, async () => {
    const tenantId = await userTenants.query().where({ id: userId }).value("tenant_id");
    return tenantId ?? DEFAULT_TENANT.id;
  });
}

function auditChecksum(payload: Record<string, unknown>): string {
  return createHash("sha256").update(JSON.stringify(payload)).digest("hex");
}

type TenantResolver = (id: number) => Promise<TenantContext | null>;

interface TenantMiddlewareOptions {
  /** Load trusted application metadata after the framework selects the tenant ID. */
  resolveTenant?: TenantResolver;
  publicTenancy?: PublicTenancyOptions;
}

async function resolveTenantForRequest(
  request: Request,
  resolver: TenantResolver,
  selectPublicTenant?: (request: Request) => Promise<number>,
): Promise<TenantContext> {
  const hostTenantId = selectPublicTenant ? await selectPublicTenant(request) : null;
  const user = currentAuthUser();
  const headerValue = request.headers.get("x-tenant-id")?.trim();
  const parsedHeader =
    headerValue !== undefined && headerValue.length > 0 ? Number(headerValue) : Number.NaN;

  if (user) {
    const userId = typeof user.id === "number" ? user.id : Number.parseInt(String(user.id), 10);

    if (Number.isInteger(userId) && userId > 0) {
      const userTenantId = await resolveUserTenantId(userId);

      if (!isGlobalAdmin(user)) {
        if (
          Number.isSafeInteger(parsedHeader) &&
          parsedHeader > 0 &&
          parsedHeader !== userTenantId
        ) {
          throw new ForbiddenError("Tenant header does not match your account.");
        }

        const memberTenant = await resolver(userTenantId);
        if (memberTenant) {
          return memberTenant;
        }

        return DEFAULT_TENANT;
      }

      if (Number.isSafeInteger(parsedHeader) && parsedHeader > 0) {
        const headerTenant = await resolver(parsedHeader);
        if (headerTenant) {
          return headerTenant;
        }

        return DEFAULT_TENANT;
      }

      const adminTenant = await resolver(userTenantId);
      if (adminTenant) {
        return adminTenant;
      }

      return DEFAULT_TENANT;
    }
  }

  const headerTenantId =
    Number.isSafeInteger(parsedHeader) && parsedHeader > 0 ? parsedHeader : null;
  const tenantId =
    hostTenantId !== null
      ? hostTenantId
      : !isProductionEnv() && process.env.TENANT_DEV_HEADERS === "true" && headerTenantId !== null
        ? headerTenantId
        : DEFAULT_TENANT.id;
  if (isProductionEnv() && !selectPublicTenant) {
    throw new ForbiddenError("Public tenant host resolver is required.");
  }
  const guestTenant = await resolver(tenantId);
  if (selectPublicTenant && !guestTenant) throw new ForbiddenError("Tenant not found.");
  if (guestTenant) {
    return guestTenant;
  }

  return DEFAULT_TENANT;
}

function createTenantMiddleware(options: TenantMiddlewareOptions = {}) {
  const resolver = options.resolveTenant ?? resolveTenant;
  const selectPublicTenant = options.publicTenancy
    ? createPublicTenantSelector(options.publicTenancy)
    : undefined;
  return async (request: Request, next: () => Promise<Response>) => {
    const pathname = new URL(request.url).pathname;

    if (pathname.startsWith("/scim/")) {
      return await next();
    }

    if (!isTenancyEnabled()) {
      return await runWithTenant(DEFAULT_TENANT, next);
    }

    try {
      const tenant = await resolveTenantForRequest(
        request,
        async (id) => {
          const tenant = await resolver(id);
          if (options.resolveTenant && tenant === null) {
            throw new ForbiddenError("Tenant not found.");
          }
          if (tenant && tenant.id !== id) {
            throw new Error("Tenant resolver returned a different tenant identity.");
          }
          return tenant;
        },
        selectPublicTenant,
      );

      return await runWithTenantDatabase(tenant, async () => {
        return await next();
      });
    } catch (error) {
      const httpError = toHttpError(error);

      if (httpError) {
        return privateJsonResponse({ error: httpError.message }, { status: httpError.status });
      }

      throw error;
    }
  };
}

export type { PublicTenancyOptions } from "./publicTenantHost";
export { normalizeTenantHostname } from "./publicTenantHost";
export type { TenantMiddlewareOptions, TenantResolver };
export { auditChecksum, createTenantMiddleware, DEFAULT_TENANT, resolveUserTenantId };
