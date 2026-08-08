import { TEST_SCIM_BEARER_TOKEN } from "../../domain/scim";
import type { Middleware } from "../http/middleware";
import { timingSafeCompareString } from "../security/timingSafeCompare";

function createScimAuthMiddleware(): Middleware {
  return async (request: Request, next: () => Promise<Response>) => {
    const configuredToken = process.env.SCIM_BEARER_TOKEN ?? TEST_SCIM_BEARER_TOKEN;
    const authorization = request.headers.get("authorization");

    if (!authorization?.startsWith("Bearer ")) {
      return jsonScimError("SCIM bearer token required.", 401);
    }

    const token = authorization.slice("Bearer ".length).trim();

    if (!timingSafeCompareString(token, configuredToken)) {
      return jsonScimError("Invalid SCIM bearer token.", 401);
    }

    return await next();
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
