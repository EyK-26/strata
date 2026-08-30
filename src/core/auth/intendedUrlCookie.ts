import { safeInternalRedirectPath, sanitizeInternalPath } from "../http/safeInternalPath";
import { appCookieName } from "../runtime/appKeyPrefix";

const INTENDED_URL_COOKIE = "workhub_intended";
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

function intendedUrlCookieName(): string {
  return process.env.INTENDED_URL_COOKIE_NAME?.trim() || appCookieName("intended");
}

function intendedUrlTtlSeconds(): number {
  const parsed = Number.parseInt(process.env.INTENDED_URL_TTL_SECONDS ?? "", 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : DEFAULT_INTENDED_URL_TTL_SECONDS;
}

function cookieSecureFlag(): string {
  return process.env.APP_ENV === "production" ? "; Secure" : "";
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

function createIntendedUrlCookie(path: string): string | null {
  const sanitized = sanitizeInternalPath(path, "");

  if (!sanitized || !isStashableIntendedPath(sanitized)) {
    return null;
  }

  return `${intendedUrlCookieName()}=${encodeURIComponent(sanitized)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${intendedUrlTtlSeconds()}${cookieSecureFlag()}`;
}

function createIntendedUrlCookieFromRequest(request: Request): string | null {
  if (request.method !== "GET" && request.method !== "HEAD") {
    return null;
  }

  return createIntendedUrlCookie(safeInternalRedirectPath(request, ""));
}

function readIntendedUrl(request: Request): string | null {
  const cookieValue = readCookieValue(request, intendedUrlCookieName());

  if (!cookieValue) {
    return null;
  }

  const sanitized = sanitizeInternalPath(cookieValue, "");

  return sanitized && isStashableIntendedPath(sanitized) ? sanitized : null;
}

function clearIntendedUrlCookie(): string {
  return `${intendedUrlCookieName()}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${cookieSecureFlag()}`;
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
