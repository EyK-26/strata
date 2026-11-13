import { timingSafeEqual } from "node:crypto";
import { type EnvRecord, isProductionEnv } from "../runtime/appEnv";
import { appCookieName, requireConfiguredSecret } from "../runtime/appKeyPrefix";
import { readRequestCookie } from "./cookies.ts";
import { currentRequestMeta } from "./requestMetaContext";

const CSRF_COOKIE = appCookieName("csrf");
const CSRF_TTL_MS = 60 * 60 * 1000;

interface CsrfTokenOptions {
  readonly secret: string;
  readonly cookieName: string;
  readonly production: boolean;
}

/** Resolve once from the application's captured environment, never a later request. */
function csrfTokenOptionsFromEnvironment(env: EnvRecord): CsrfTokenOptions {
  return Object.freeze({
    secret: requireConfiguredSecret(["SESSION_SECRET", "CSRF_SECRET"], "csrf-secret", env),
    cookieName: env.CSRF_COOKIE_NAME?.trim() || appCookieName("csrf", env),
    production: isProductionEnv(env),
  });
}

function csrfCookieName(options?: CsrfTokenOptions): string {
  return options?.cookieName ?? (process.env.CSRF_COOKIE_NAME?.trim() || appCookieName("csrf"));
}

function csrfVerifyOptions(options: CsrfTokenOptions) {
  return { secret: options.secret, maxAge: CSRF_TTL_MS };
}

function verifyCsrfTokenValue(token: string, options: CsrfTokenOptions): boolean {
  return Bun.CSRF.verify(token, csrfVerifyOptions(options));
}

function tokensMatch(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);

  if (leftBuffer.length !== rightBuffer.length) {
    return false;
  }

  return timingSafeEqual(leftBuffer, rightBuffer);
}

function createCsrfTokenCookie(
  options: CsrfTokenOptions = csrfTokenOptionsFromEnvironment(process.env),
): { token: string; cookie: string } {
  const token = Bun.CSRF.generate(options.secret, { expiresIn: CSRF_TTL_MS });

  const secure = options.production ? "; Secure" : "";

  return {
    token,
    cookie: `${csrfCookieName(options)}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${Math.floor(CSRF_TTL_MS / 1000)}${secure}`,
  };
}

function resolveCsrfToken(
  request: Request,
  options: CsrfTokenOptions = csrfTokenOptionsFromEnvironment(process.env),
): { token: string; cookie?: string } {
  const cookieValue = readRequestCookie(request, csrfCookieName(options));

  if (cookieValue && verifyCsrfTokenValue(cookieValue, options)) {
    return { token: cookieValue };
  }

  return createCsrfTokenCookie(options);
}

function readSubmittedCsrfToken(request: Request): string | null {
  const headerToken = request.headers.get("x-csrf-token")?.trim();

  if (headerToken) {
    return headerToken;
  }

  return null;
}

async function readSubmittedCsrfTokenFromBody(request: Request): Promise<string | null> {
  const headerToken = readSubmittedCsrfToken(request);

  if (headerToken) {
    return headerToken;
  }

  const contentType = request.headers.get("content-type")?.toLowerCase() ?? "";

  if (
    contentType.includes("application/x-www-form-urlencoded") ||
    contentType.includes("multipart/form-data")
  ) {
    const formData = await request.clone().formData();
    const field = formData.get("_token");

    if (typeof field === "string" && field.trim().length > 0) {
      return field.trim();
    }

    const legacyField = formData.get("_csrf");

    if (typeof legacyField === "string" && legacyField.trim().length > 0) {
      return legacyField.trim();
    }
  }

  return null;
}

function verifyCsrfToken(
  request: Request,
  submittedToken: string | null,
  options: CsrfTokenOptions = csrfTokenOptionsFromEnvironment(process.env),
): boolean {
  if (!submittedToken) {
    return false;
  }

  const cookieValue = readRequestCookie(request, csrfCookieName(options));

  if (!cookieValue) {
    return false;
  }

  if (!tokensMatch(submittedToken, cookieValue)) {
    return false;
  }

  return verifyCsrfTokenValue(submittedToken, options);
}

function resolveCsrfTokenForRequest(
  request: Request,
  options: CsrfTokenOptions = csrfTokenOptionsFromEnvironment(process.env),
): string {
  const metaToken = currentRequestMeta().csrfToken;

  if (metaToken && verifyCsrfTokenValue(metaToken, options)) {
    return metaToken;
  }

  return resolveCsrfToken(request, options).token;
}

export type { CsrfTokenOptions };
export {
  CSRF_COOKIE,
  createCsrfTokenCookie,
  csrfCookieName,
  csrfTokenOptionsFromEnvironment,
  readSubmittedCsrfToken,
  readSubmittedCsrfTokenFromBody,
  resolveCsrfToken,
  resolveCsrfTokenForRequest,
  verifyCsrfToken,
  verifyCsrfTokenValue,
};
