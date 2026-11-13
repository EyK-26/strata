import { createHash } from "node:crypto";
import { isGlobalAdmin } from "@getstrata/core/auth/accessControl";
import { ForbiddenError } from "@getstrata/core/errors/http";
import type { AuthUser, CredentialSource } from "../auth/authContext";
import { createPublicTenantSelector, type PublicTenancyOptions } from "./publicTenantHost";
import { runWithTenant, type TenantContext } from "./tenantContext";

const DEFAULT_TENANT: TenantContext = {
  id: 1,
  slug: "default",
};

function auditChecksum(payload: Record<string, unknown>): string {
  return createHash("sha256").update(JSON.stringify(payload)).digest("hex");
}

type TenantResolver = (id: number) => Promise<TenantContext | null>;

interface TenantMiddlewareOptions {
  /** Load trusted application metadata after the framework selects the tenant ID. */
  resolveTenant: TenantResolver;
  userTenantId(userId: number): Promise<number>;
  auth: { user: AuthUser | null; credentialSource: CredentialSource };
  config: { enabled: boolean; production: boolean; allowDevHeaders: boolean };
  publicTenancy?: PublicTenancyOptions;
}

async function resolveTenantForRequest(
  request: Request,
  options: TenantMiddlewareOptions,
  resolver: TenantResolver,
  selectPublicTenant?: (request: Request) => Promise<number>,
): Promise<TenantContext> {
  const hostTenantId = selectPublicTenant ? await selectPublicTenant(request) : null;
  const user = options.auth.user;
  const headerValue = request.headers.get("x-tenant-id")?.trim();
  const parsedHeader =
    headerValue !== undefined && headerValue.length > 0 ? Number(headerValue) : Number.NaN;

  // GuestGuard identities are development principals, not persisted account rows.
  if (user && options.auth.credentialSource !== "guest") {
    const userId = typeof user.id === "number" ? user.id : Number.parseInt(String(user.id), 10);

    if (Number.isInteger(userId) && userId > 0) {
      const userTenantId = await options.userTenantId(userId);

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

        throw new ForbiddenError("Tenant not found.");
      }

      if (Number.isSafeInteger(parsedHeader) && parsedHeader > 0) {
        const headerTenant = await resolver(parsedHeader);
        if (headerTenant) {
          return headerTenant;
        }

        throw new ForbiddenError("Tenant not found.");
      }

      const adminTenant = await resolver(userTenantId);
      if (adminTenant) {
        return adminTenant;
      }

      throw new ForbiddenError("Tenant not found.");
    }
  }

  const headerTenantId =
    Number.isSafeInteger(parsedHeader) && parsedHeader > 0 ? parsedHeader : null;
  const tenantId =
    hostTenantId !== null
      ? hostTenantId
      : !options.config.production && options.config.allowDevHeaders && headerTenantId !== null
        ? headerTenantId
        : DEFAULT_TENANT.id;
  if (options.config.production && !selectPublicTenant) {
    throw new ForbiddenError("Public tenant host resolver is required.");
  }
  const guestTenant = await resolver(tenantId);
  if (selectPublicTenant && !guestTenant) throw new ForbiddenError("Tenant not found.");
  if (guestTenant) {
    return guestTenant;
  }

  throw new ForbiddenError("Tenant not found.");
}

function createTenantMiddleware(options: TenantMiddlewareOptions) {
  const selectPublicTenant = options.publicTenancy
    ? createPublicTenantSelector(options.publicTenancy)
    : undefined;
  return async (request: Request, next: () => Promise<Response>) => {
    const tenant = !options.config.enabled
      ? DEFAULT_TENANT
      : await resolveTenantForRequest(
          request,
          options,
          async (id) => {
            const value = await options.resolveTenant(id);
            if (!value) throw new ForbiddenError("Tenant not found.");
            if (value.id !== id)
              throw new Error("Tenant resolver returned a different tenant identity.");
            return value;
          },
          selectPublicTenant,
        );
    return await runWithTenant(tenant, next);
  };
}

export type { PublicTenancyOptions } from "./publicTenantHost";
export { normalizeTenantHostname } from "./publicTenantHost";
export type { TenantMiddlewareOptions, TenantResolver };
export { auditChecksum, createTenantMiddleware, DEFAULT_TENANT, resolveTenantForRequest };
