import { currentAuthUser } from "@getstrata/core/auth/authContext";
import type { AuthManager } from "@getstrata/core/auth/guard";
import type { Policy, PolicyGate } from "@getstrata/core/auth/policy";
import { ForbiddenError } from "@getstrata/core/errors/http";
import { errorResponse } from "@getstrata/core/http/response";
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
      return errorResponse(error);
    }

    return await next();
  };
}

export { createAuthorizeMiddleware };
