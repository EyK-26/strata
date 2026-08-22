import { timingSafeEqual } from "node:crypto";
import { readRequestCookie } from "./cookies.ts";
import { currentRequestMeta } from "./requestMetaContext";

const CSRF_COOKIE = "workhub_csrf";
const CSRF_TTL_MS = 60 * 60 * 1000;

function resolveCsrfSecret(): string {
  return (
    process.env.SESSION_SECRET?.trim() ||
    process.env.OAUTH_STATE_SECRET?.trim() ||
    process.env.ADMIN_API_TOKEN?.trim() ||
    "workhub-dev-csrf-secret"
  );
}

function csrfVerifyOptions() {
  return { secret: resolveCsrfSecret(), maxAge: CSRF_TTL_MS };
}

function tokensMatch(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);

  if (leftBuffer.length !== rightBuffer.length) {
    return false;
  }

  return timingSafeEqual(leftBuffer, rightBuffer);
}

function createCsrfTokenCookie(): { token: string; cookie: string } {
  const token = Bun.CSRF.generate(resolveCsrfSecret(), { expiresIn: CSRF_TTL_MS });

  const secure = process.env.APP_ENV === "production" ? "; Secure" : "";

  return {
    token,
    cookie: `${CSRF_COOKIE}=${encodeURIComponent(token)}; Path=/; SameSite=Lax; Max-Age=${Math.floor(CSRF_TTL_MS / 1000)}${secure}`,
  };
}

function resolveCsrfToken(request: Request): { token: string; cookie?: string } {
  const cookieValue = readRequestCookie(request, CSRF_COOKIE);

  if (cookieValue && Bun.CSRF.verify(cookieValue, csrfVerifyOptions())) {
    return { token: cookieValue };
  }

  return createCsrfTokenCookie();
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

function verifyCsrfToken(request: Request, submittedToken: string | null): boolean {
  if (!submittedToken) {
    return false;
  }

  const cookieValue = readRequestCookie(request, CSRF_COOKIE);

  if (!cookieValue) {
    return false;
  }

  if (!tokensMatch(submittedToken, cookieValue)) {
    return false;
  }

  return Bun.CSRF.verify(submittedToken, csrfVerifyOptions());
}

function resolveCsrfTokenForRequest(request: Request): string {
  const metaToken = currentRequestMeta().csrfToken;

  if (metaToken) {
    return metaToken;
  }

  return resolveCsrfToken(request).token;
}

export {
  CSRF_COOKIE,
  createCsrfTokenCookie,
  readSubmittedCsrfToken,
  readSubmittedCsrfTokenFromBody,
  resolveCsrfToken,
  resolveCsrfTokenForRequest,
  verifyCsrfToken,
};
