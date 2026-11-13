import type { DatabaseSession } from "../database/session";
import type { TenantContext } from "../tenant/tenantContext";
export interface ScimAuthenticationOptions {
  readonly resolveToken: (token: string) => number | null;
  readonly resolveTenant: (database: DatabaseSession, id: number) => Promise<TenantContext | null>;
}
export function createScimAuthenticator(options: ScimAuthenticationOptions) {
  const { resolveToken, resolveTenant } = options;
  return async (request: Request, database: DatabaseSession): Promise<TenantContext | Response> => {
    const authorization = request.headers.get("authorization");
    if (!authorization?.startsWith("Bearer "))
      return jsonScimError("SCIM bearer token required.", 401);
    const tenantId = resolveToken(authorization.slice("Bearer ".length).trim());
    if (tenantId === null) return jsonScimError("Invalid SCIM bearer token.", 401);
    const tenant = await resolveTenant(database, tenantId);
    if (!tenant) return jsonScimError("SCIM tenant not found.", 401);
    if (tenant.id !== tenantId)
      throw new Error("SCIM tenant resolver returned a different identity.");
    return tenant;
  };
}
/** Breaking alias: this is an explicit metadata authenticator, not a next()-based transaction wrapper. */
export const createScimAuthMiddleware = createScimAuthenticator;
export function jsonScimError(detail: string, status: number): Response {
  return Response.json(
    { schemas: ["urn:ietf:params:scim:api:messages:2.0:Error"], detail, status: String(status) },
    { status, headers: { "content-type": "application/scim+json" } },
  );
}
