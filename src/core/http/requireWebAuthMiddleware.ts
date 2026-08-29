import { runWithAuthUser } from "@getstrata/core/auth/authContext";
import type { AuthManager } from "@getstrata/core/auth/guard";
import { UnauthorizedError } from "@getstrata/core/errors/http";
import { requestPrefersJson } from "./contentNegotiation";
import type { Middleware } from "./middleware";
import { loginRedirectLocation } from "./safeInternalPath";

function createRequireWebAuthMiddleware(auth: AuthManager): Middleware {
  return async (request: Request, next: () => Promise<Response>) => {
    const user = await auth.resolve(request);

    if (user) {
      return await runWithAuthUser(user, () => next());
    }

    if (requestPrefersJson(request)) {
      throw new UnauthorizedError();
    }

    return Response.redirect(loginRedirectLocation(request), 302);
  };
}

export { createRequireWebAuthMiddleware };
