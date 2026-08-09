import type { AuthManager } from "../auth/guard";
import { UnauthorizedError } from "../errors/http";
import { requestPrefersJson } from "./contentNegotiation";
import type { Middleware } from "./middleware";

function createRequireWebAuthMiddleware(auth: AuthManager): Middleware {
  return async (request: Request, next: () => Promise<Response>) => {
    const user = await auth.resolve(request);

    if (user) {
      return await next();
    }

    if (requestPrefersJson(request)) {
      throw new UnauthorizedError();
    }

    const redirectTarget = encodeURIComponent(new URL(request.url).pathname);

    return Response.redirect(`/login?redirect=${redirectTarget}`, 302);
  };
}

export { createRequireWebAuthMiddleware };
