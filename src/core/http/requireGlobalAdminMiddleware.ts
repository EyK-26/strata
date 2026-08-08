import { isGlobalAdmin } from "../auth/accessControl";
import { currentAuthUser } from "../auth/authContext";
import { ForbiddenError } from "../errors/http";
import type { Middleware } from "./middleware";

function createRequireGlobalAdminMiddleware(): Middleware {
  return async (_request: Request, next: () => Promise<Response>) => {
    const user = currentAuthUser();

    if (!isGlobalAdmin(user)) {
      const error = new ForbiddenError("Platform admin access required.");

      return Response.json({ error: error.message }, { status: error.status });
    }

    return await next();
  };
}

export { createRequireGlobalAdminMiddleware };
