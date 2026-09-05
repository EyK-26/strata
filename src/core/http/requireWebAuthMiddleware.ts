import { runWithAuthUser } from "@getstrata/core/auth/authContext";
import type { AuthManager } from "@getstrata/core/auth/guard";
import { createIntendedUrlCookieFromRequest } from "@getstrata/core/auth/intendedUrlCookie";
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

    const intended = createIntendedUrlCookieFromRequest(request);
    const headers = new Headers({ Location: loginRedirectLocation(request) });
    if (intended) {
      headers.append("Set-Cookie", intended);
    }
    return new Response(null, { status: 302, headers });
  };
}

export { createRequireWebAuthMiddleware };
