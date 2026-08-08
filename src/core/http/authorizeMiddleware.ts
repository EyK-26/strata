import type { AuthManager } from "../auth/guard";
import type { PolicyGate } from "../auth/policy";
import type { Policy } from "../auth/policy";
import { ForbiddenError } from "../errors/http";
import type { Middleware } from "./middleware";

function createAuthorizeMiddleware(
  gate: PolicyGate,
  auth: AuthManager,
  resource: string,
  action: keyof Policy,
): Middleware {
  return async (request: Request, next: () => Promise<Response>) => {
    const user = await auth.resolve(request);

    if (!gate.allows(resource, action, user)) {
      const error = new ForbiddenError();
      return Response.json({ error: error.message }, { status: error.status });
    }

    return await next();
  };
}

export { createAuthorizeMiddleware };
