import { safeInternalRedirectPath, sanitizeInternalPath } from "../http/safeInternalPath";
import { isProductionEnv } from "../runtime/appEnv";
import { appCookieName } from "../runtime/appKeyPrefix";

const INTENDED_URL_COOKIE = "strata_intended";
const DEFAULT_INTENDED_URL_TTL_SECONDS = 60 * 60 * 24;

const SKIP_EXACT_PATHS = new Set([
  "/email/verify",
  "/verify-email",
  "/login",
  "/register",
  "/logout",
  "/forgot-password",
  "/reset-password",
  "/two-factor-challenge",
  "/confirm-password",
  "/api",
]);

export interface IntendedUrlCookieOptions {
  readonly cookieName: string;
  readonly ttlSeconds: number;
  readonly production: boolean;
}
export function intendedUrlCookieOptionsFromEnvironment(
  env: Readonly<Record<string, string | undefined>>,
): IntendedUrlCookieOptions {
  return Object.freeze({
    cookieName: intendedUrlCookieName(env),
    ttlSeconds: intendedUrlTtlSeconds(env),
    production: isProductionEnv(env),
  });
}
function intendedUrlCookieName(env: Readonly<Record<string, string | undefined>>): string {
  return env.INTENDED_URL_COOKIE_NAME?.trim() || appCookieName("intended", env);
}

function intendedUrlTtlSeconds(env: Readonly<Record<string, string | undefined>>): number {
  const parsed = Number.parseInt(env.INTENDED_URL_TTL_SECONDS ?? "", 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : DEFAULT_INTENDED_URL_TTL_SECONDS;
}

function cookieSecureFlag(options: IntendedUrlCookieOptions): string {
  return options.production ? "; Secure" : "";
}

function pathnameOf(path: string): string {
  const pathname = path.split("?")[0] ?? path;
  const trimmed = pathname.replace(/\/+$/, "");

  return trimmed || "/";
}

function isStashableIntendedPath(path: string): boolean {
  if (!path.startsWith("/") || path.startsWith("//")) {
    return false;
  }

  const pathname = pathnameOf(path);

  if (
    SKIP_EXACT_PATHS.has(pathname) ||
    pathname.startsWith("/oauth") ||
    pathname.startsWith("/api/")
  ) {
    return false;
  }

  return true;
}

function readCookieValue(request: Request, cookieName: string): string | null {
  const cookieHeader = request.headers.get("cookie");

  if (!cookieHeader) {
    return null;
  }

  for (const part of cookieHeader.split(";")) {
    const [name, ...rest] = part.trim().split("=");

    if (name === cookieName) {
      return decodeURIComponent(rest.join("="));
    }
  }

  return null;
}

function createIntendedUrlCookie(path: string, options: IntendedUrlCookieOptions): string | null {
  const sanitized = sanitizeInternalPath(path, "");

  if (!sanitized || !isStashableIntendedPath(sanitized)) {
    return null;
  }

  return `${options.cookieName}=${encodeURIComponent(sanitized)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${options.ttlSeconds}${cookieSecureFlag(options)}`;
}

function createIntendedUrlCookieFromRequest(
  request: Request,
  options: IntendedUrlCookieOptions,
): string | null {
  if (request.method !== "GET" && request.method !== "HEAD") {
    return null;
  }

  return createIntendedUrlCookie(safeInternalRedirectPath(request, ""), options);
}

function readIntendedUrl(request: Request, options: IntendedUrlCookieOptions): string | null {
  const cookieValue = readCookieValue(request, options.cookieName);

  if (!cookieValue) {
    return null;
  }

  const sanitized = sanitizeInternalPath(cookieValue, "");

  return sanitized && isStashableIntendedPath(sanitized) ? sanitized : null;
}

function clearIntendedUrlCookie(options: IntendedUrlCookieOptions): string {
  return `${options.cookieName}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${cookieSecureFlag(options)}`;
}

export {
  clearIntendedUrlCookie,
  createIntendedUrlCookie,
  createIntendedUrlCookieFromRequest,
  DEFAULT_INTENDED_URL_TTL_SECONDS,
  INTENDED_URL_COOKIE,
  intendedUrlCookieName,
  intendedUrlTtlSeconds,
  isStashableIntendedPath,
  readIntendedUrl,
};
