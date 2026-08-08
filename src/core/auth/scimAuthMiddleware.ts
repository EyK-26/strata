import type { Middleware } from "../http/middleware";
import { resolveScimTenantFromToken } from "../security/scimTenantTokens";
import { resolveTenant } from "../tenant/resolveTenant";
import { runWithTenant } from "../tenant/tenantContext";

function createScimAuthMiddleware(): Middleware {
  return async (request: Request, next: () => Promise<Response>) => {
    const authorization = request.headers.get("authorization");

    if (!authorization?.startsWith("Bearer ")) {
      return jsonScimError("SCIM bearer token required.", 401);
    }

    const token = authorization.slice("Bearer ".length).trim();
    const tenantId = resolveScimTenantFromToken(token);

    if (tenantId === null) {
      return jsonScimError("Invalid SCIM bearer token.", 401);
    }

    const tenant = await resolveTenant(tenantId);

    if (!tenant) {
      return jsonScimError("SCIM tenant not found.", 401);
    }

    return await runWithTenant(tenant, async () => await next());
  };
}

function jsonScimError(detail: string, status: number): Response {
  return Response.json(
    {
      schemas: ["urn:ietf:params:scim:api:messages:2.0:Error"],
      detail,
      status: String(status),
    },
    {
      status,
      headers: { "content-type": "application/scim+json" },
    },
  );
}

export { createScimAuthMiddleware };
