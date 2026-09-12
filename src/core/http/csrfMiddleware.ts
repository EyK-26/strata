import { currentCredentialSource } from "@getstrata/core/auth/authContext";
import { ForbiddenError } from "@getstrata/core/errors/http";
import { readSubmittedCsrfTokenFromBody, resolveCsrfToken, verifyCsrfToken } from "./csrfToken";
import type { Middleware } from "./middleware";
import { currentRequestMeta } from "./requestMetaContext";

const MUTATING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

function samlAcsPathname(): string {
  const configured = process.env.SAML_ACS_URL?.trim();
  if (!configured) {
    return "/auth/saml/acs";
  }

  try {
    return new URL(configured, "http://strata.invalid").pathname;
  } catch {
    return "/auth/saml/acs";
  }
}

function skipsCsrfPath(pathname: string): boolean {
  return pathname === samlAcsPathname() || pathname.startsWith("/scim/");
}

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
    const credentialSource = currentCredentialSource();
    if (credentialSource === "bearer" || credentialSource === "basic") {
      return await next();
    }

    const pathname = new URL(request.url).pathname;
    if (skipsCsrfPath(pathname)) {
      return await next();
    }

    const method = request.method.toUpperCase();

    if (!MUTATING_METHODS.has(method)) {
      const meta = currentRequestMeta();
      const csrf = meta.csrfToken ? { token: meta.csrfToken } : resolveCsrfToken(request);
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
