import type { AuthManager } from "@getstrata/core/auth/guard";
import { UnauthorizedError } from "@getstrata/core/errors/http";
import { errorResponse } from "@getstrata/core/http/response";
import type { Middleware } from "./middleware";

function createRequireAuthMiddleware(auth: AuthManager): Middleware {
  return async (request: Request, next: () => Promise<Response>) => {
    if (!(await auth.check(request))) {
      const error = new UnauthorizedError();
      return errorResponse(error);
    }

    return await next();
  };
}

export { createRequireAuthMiddleware };
