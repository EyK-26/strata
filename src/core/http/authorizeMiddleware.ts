import { currentAuthUser } from "../auth/authContext";
import type { AuthManager } from "../auth/guard";
import type { Policy, PolicyGate } from "../auth/policy";
import { ForbiddenError } from "../errors/http";
import type { Middleware } from "./middleware";

function createAuthorizeMiddleware(
  gate: PolicyGate,
  auth: AuthManager,
  resource: string,
  action: keyof Policy,
): Middleware {
  return async (request: Request, next: () => Promise<Response>) => {
    const user = currentAuthUser() ?? (await auth.resolve(request));

    if (!gate.allows(resource, action, user)) {
      const error = new ForbiddenError();
      return Response.json({ error: error.message }, { status: error.status });
    }

    return await next();
  };
}

export { createAuthorizeMiddleware };
