import { currentAuthUser, currentCredentialSource } from "@getstrata/core/auth/authContext";
import { ForbiddenError } from "@getstrata/core/errors/http";
import { envFlagEnabled } from "@getstrata/core/runtime/appEnv";
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
import { currentRequestMeta, runWithRequestMeta } from "./requestMetaContext";

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

export function csrfMiddlewareOptionsFromEnvironment(
  env: Readonly<Record<string, string | undefined>>,
): CsrfOptions {
  return Object.freeze({
    token: csrfTokenOptionsFromEnvironment(env),
    allowDevelopmentHeaders: envFlagEnabled(env.AUTH_DEV_HEADERS),
    samlAcsUrl: env.SAML_ACS_URL,
  });
}
function createCsrfMiddleware(options: CsrfOptions): Middleware {
  const tokenOptions = options.token ? Object.freeze({ ...options.token }) : undefined;
  const capturedToken = () => {
    if (!tokenOptions) throw new TypeError("Explicit CSRF token configuration is required.");
    return tokenOptions;
  };
  const production = tokenOptions?.production ?? true;
  const allowDevelopmentHeaders = options.allowDevelopmentHeaders ?? false;
  const samlPathname = samlAcsPathname(options.samlAcsUrl);
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
        meta.request === request &&
        meta.csrfToken &&
        verifyCsrfTokenValue(meta.csrfToken, capturedToken())
          ? { token: meta.csrfToken }
          : resolveCsrfToken(request, capturedToken());
      const scopedMeta =
        meta.request === request
          ? meta
          : {
              ipAddress: null,
              userAgent: request.headers.get("user-agent"),
              errorFormat: meta.errorFormat,
              webErrorView: meta.webErrorView,
              viewsEnabled: meta.viewsEnabled,
              webErrorsProduction: meta.webErrorsProduction,
            };
      const response = await runWithRequestMeta(
        { ...scopedMeta, request, csrfToken: csrf.token },
        next,
      );

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
