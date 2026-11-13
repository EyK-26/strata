import { currentAuthUser, currentCredentialSource } from "@getstrata/core/auth/authContext";
import { ForbiddenError } from "@getstrata/core/errors/http";
import { envFlagEnabled, isProductionEnv } from "@getstrata/core/runtime/appEnv";
import { createCsrfOriginPolicy } from "./csrfOriginPolicy";
import {
  type CsrfTokenOptions,
  csrfTokenOptionsFromEnvironment,
  readSubmittedCsrfTokenFromBody,
  resolveCsrfToken,
  verifyCsrfToken,
  verifyCsrfTokenValue,
} from "./csrfToken";
import type { Middleware } from "./middleware";
import { currentRequestMeta } from "./requestMetaContext";

const MUTATING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

interface CsrfOptions {
  /** Explicit public origin for TLS offload; requires matching URL authority and Host on every request. */
  targetOrigin?: string;
  readonly token?: CsrfTokenOptions;
  readonly allowDevelopmentHeaders?: boolean;
  readonly samlAcsUrl?: string;
}

function samlAcsPathname(value: string | undefined): string {
  const configured = value?.trim();
  if (!configured) {
    return "/auth/saml/acs";
  }

  try {
    return new URL(configured, "http://strata.invalid").pathname;
  } catch {
    return "/auth/saml/acs";
  }
}

function skipsCsrfPath(pathname: string, samlPathname: string): boolean {
  return (
    pathname === samlPathname ||
    pathname.startsWith("/scim/") ||
    pathname.startsWith("/billing/webhooks/")
  );
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

function createCsrfMiddleware(options: CsrfOptions = {}): Middleware {
  const env = Object.freeze({ ...process.env });
  let tokenOptions = options.token ? Object.freeze({ ...options.token }) : undefined;
  const capturedToken = () => (tokenOptions ??= csrfTokenOptionsFromEnvironment(env));
  const production = tokenOptions?.production ?? isProductionEnv(env);
  const allowDevelopmentHeaders =
    options.allowDevelopmentHeaders ?? envFlagEnabled(env.AUTH_DEV_HEADERS);
  const samlPathname = samlAcsPathname(options.samlAcsUrl ?? env.SAML_ACS_URL);
  const targetOrigin = options.targetOrigin;
  const policy = targetOrigin === undefined ? undefined : createCsrfOriginPolicy(targetOrigin);
  return async (request: Request, next: () => Promise<Response>) => {
    policy?.assertHost(request);
    const credentialSource = currentCredentialSource();
    const developmentHeaderProof =
      credentialSource === "guest" &&
      currentAuthUser() !== null &&
      allowDevelopmentHeaders &&
      !production;
    if (credentialSource === "bearer" || credentialSource === "basic" || developmentHeaderProof) {
      return await next();
    }

    const pathname = new URL(request.url).pathname;
    if (skipsCsrfPath(pathname, samlPathname)) {
      return await next();
    }

    const method = request.method.toUpperCase();

    if (!MUTATING_METHODS.has(method)) {
      const meta = currentRequestMeta();
      const csrf =
        meta.csrfToken && verifyCsrfTokenValue(meta.csrfToken, capturedToken())
          ? { token: meta.csrfToken }
          : resolveCsrfToken(request, capturedToken());
      meta.csrfToken = csrf.token;
      const response = await next();

      if (!csrf.cookie) {
        return response;
      }

      return appendSetCookie(response, csrf.cookie);
    }

    const submitted = await readSubmittedCsrfTokenFromBody(request);

    if (!verifyCsrfToken(request, submitted, capturedToken())) {
      throw new ForbiddenError("Invalid or missing CSRF token.");
    }

    const originHeader = request.headers.get("origin");
    let headerOrigin: string | null = null;
    if (!policy && originHeader) {
      try {
        headerOrigin = new URL(originHeader).origin;
      } catch {
        headerOrigin = null;
      }
    }
    if (
      policy
        ? !policy.acceptsSourceOrigin(originHeader)
        : !headerOrigin || headerOrigin !== new URL(request.url).origin
    ) {
      throw new ForbiddenError("Cross-site cookie requests are not allowed.");
    }

    return await next();
  };
}

export type { CsrfOptions };
export { createCsrfMiddleware };
