import { ForbiddenError } from "@getstrata/core/errors/http";
import { readSubmittedCsrfTokenFromBody, resolveCsrfToken, verifyCsrfToken } from "./csrfToken";
import type { Middleware } from "./middleware";
import { currentRequestMeta } from "./requestMetaContext";

const MUTATING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

function appendSetCookie(response: Response, cookie: string): Response {
  const headers = new Headers(response.headers);
  headers.append("set-cookie", cookie);

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

function createCsrfMiddleware(): Middleware {
  return async (request: Request, next: () => Promise<Response>) => {
    const method = request.method.toUpperCase();

    if (!MUTATING_METHODS.has(method)) {
      const csrf = resolveCsrfToken(request);
      const meta = currentRequestMeta();
      meta.csrfToken = csrf.token;
      const response = await next();

      if (!csrf.cookie) {
        return response;
      }

      return appendSetCookie(response, csrf.cookie);
    }

    const submitted = await readSubmittedCsrfTokenFromBody(request);

    if (!verifyCsrfToken(request, submitted)) {
      throw new ForbiddenError("Invalid or missing CSRF token.");
    }

    return await next();
  };
}

export { createCsrfMiddleware };
