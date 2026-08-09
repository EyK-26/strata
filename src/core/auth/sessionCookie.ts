import { createHmac, timingSafeEqual } from "node:crypto";

const SESSION_COOKIE = "workhub_session";
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 7;

function resolveSessionSecret(): string {
  return (
    process.env.SESSION_SECRET?.trim() ||
    process.env.OAUTH_STATE_SECRET?.trim() ||
    process.env.ADMIN_API_TOKEN?.trim() ||
    "workhub-dev-session-secret"
  );
}

function signSession(userId: number, issuedAt: number): string {
  const payload = `${userId}.${issuedAt}`;
  const signature = createHmac("sha256", resolveSessionSecret()).update(payload).digest("hex");

  return `${payload}.${signature}`;
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

function readSessionUserId(request: Request): number | null {
  const cookieValue = readCookieValue(request, SESSION_COOKIE);

  if (!cookieValue) {
    return null;
  }

  const parts = cookieValue.split(".");

  if (parts.length !== 3) {
    return null;
  }

  const [userIdRaw, issuedAtRaw, cookieSignature] = parts;
  const userId = Number.parseInt(String(userIdRaw), 10);
  const issuedAt = Number.parseInt(String(issuedAtRaw), 10);

  if (!Number.isInteger(userId) || userId <= 0 || !Number.isFinite(issuedAt)) {
    return null;
  }

  if (Date.now() - issuedAt > SESSION_TTL_SECONDS * 1000) {
    return null;
  }

  const expectedSignature = signSession(userId, issuedAt).split(".").pop();

  if (!expectedSignature || !cookieSignature) {
    return null;
  }

  const expectedBuffer = Buffer.from(expectedSignature);
  const actualBuffer = Buffer.from(cookieSignature);

  if (expectedBuffer.length !== actualBuffer.length) {
    return null;
  }

  if (!timingSafeEqual(expectedBuffer, actualBuffer)) {
    return null;
  }

  return userId;
}

function createSessionCookie(userId: number): string {
  const issuedAt = Date.now();
  const value = signSession(userId, issuedAt);
  const secure = process.env.APP_ENV === "production" ? "; Secure" : "";

  return `${SESSION_COOKIE}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_TTL_SECONDS}${secure}`;
}

function clearSessionCookie(): string {
  const secure = process.env.APP_ENV === "production" ? "; Secure" : "";

  return `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure}`;
}

export {
  clearSessionCookie,
  createSessionCookie,
  readSessionUserId,
  SESSION_COOKIE,
  SESSION_TTL_SECONDS,
};
