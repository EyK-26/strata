import { createHmac, timingSafeEqual } from "node:crypto";
import { appCookieName, appDevSecret } from "../runtime/appKeyPrefix";

const SESSION_COOKIE = "workhub_session";
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 7;
const SESSION_REMEMBER_TTL_SECONDS = 60 * 60 * 24 * 30;

interface CreateSessionCookieOptions {
  remember?: boolean;
}

interface SignedSession {
  userId: number;
  issuedAt: number;
}

function sessionCookieName(): string {
  return process.env.SESSION_COOKIE_NAME?.trim() || appCookieName("session");
}

function parsePositiveSeconds(raw: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(raw ?? "", 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function sessionTtlSeconds(): number {
  return parsePositiveSeconds(process.env.SESSION_TTL_SECONDS, SESSION_TTL_SECONDS);
}

function sessionRememberTtlSeconds(): number {
  return parsePositiveSeconds(
    process.env.SESSION_REMEMBER_TTL_SECONDS,
    SESSION_REMEMBER_TTL_SECONDS,
  );
}

function resolveSessionSecret(): string {
  return (
    process.env.SESSION_SECRET?.trim() ||
    process.env.OAUTH_STATE_SECRET?.trim() ||
    process.env.ADMIN_API_TOKEN?.trim() ||
    appDevSecret("session-secret")
  );
}

function signSession(userId: number, issuedAt: number, ttlSeconds?: number): string {
  const payload =
    ttlSeconds === undefined ? `${userId}.${issuedAt}` : `${userId}.${issuedAt}.${ttlSeconds}`;
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

function readSignedSession(
  userIdRaw: string,
  issuedAtRaw: string,
  cookieSignature: string | undefined,
  ttlSeconds: number,
  remember: boolean,
): SignedSession | null {
  const userId = Number.parseInt(userIdRaw, 10);
  const issuedAt = Number.parseInt(issuedAtRaw, 10);

  if (!Number.isInteger(userId) || userId <= 0 || !Number.isFinite(issuedAt)) {
    return null;
  }

  if (!Number.isInteger(ttlSeconds) || ttlSeconds <= 0) {
    return null;
  }

  if (Date.now() - issuedAt > ttlSeconds * 1000) {
    return null;
  }

  const expectedSignature = (
    remember ? signSession(userId, issuedAt, ttlSeconds) : signSession(userId, issuedAt)
  )
    .split(".")
    .pop();

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

  return { userId, issuedAt };
}

function readSession(request: Request): SignedSession | null {
  const cookieValue = readCookieValue(request, sessionCookieName());

  if (!cookieValue) {
    return null;
  }

  const parts = cookieValue.split(".");

  if (parts.length === 4) {
    const [userIdRaw, issuedAtRaw, ttlRaw, cookieSignature] = parts;
    return readSignedSession(
      String(userIdRaw),
      String(issuedAtRaw),
      cookieSignature,
      Number.parseInt(String(ttlRaw), 10),
      true,
    );
  }

  if (parts.length !== 3) {
    return null;
  }

  const [userIdRaw, issuedAtRaw, cookieSignature] = parts;
  return readSignedSession(
    String(userIdRaw),
    String(issuedAtRaw),
    cookieSignature,
    sessionTtlSeconds(),
    false,
  );
}

function readSessionUserId(request: Request): number | null {
  return readSession(request)?.userId ?? null;
}

function isSessionInvalidated(
  issuedAt: number,
  validAfter: Date | string | null | undefined,
): boolean {
  if (!validAfter) {
    return false;
  }

  const timestamp =
    validAfter instanceof Date ? validAfter.getTime() : Date.parse(String(validAfter));

  if (!Number.isFinite(timestamp)) {
    return false;
  }

  return issuedAt < timestamp;
}

interface SessionCookieDetails {
  header: string;
  userId: number;
  issuedAt: number;
  ttlSeconds: number;
}

function createSessionCookieDetails(
  userId: number,
  options: CreateSessionCookieOptions = {},
): SessionCookieDetails {
  const issuedAt = Date.now();
  const ttlSeconds = options.remember ? sessionRememberTtlSeconds() : sessionTtlSeconds();
  const value = options.remember
    ? signSession(userId, issuedAt, ttlSeconds)
    : signSession(userId, issuedAt);
  const secure = process.env.APP_ENV === "production" ? "; Secure" : "";

  return {
    header: `${sessionCookieName()}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${ttlSeconds}${secure}`,
    userId,
    issuedAt,
    ttlSeconds,
  };
}

function createSessionCookie(userId: number, options: CreateSessionCookieOptions = {}): string {
  return createSessionCookieDetails(userId, options).header;
}

function clearSessionCookie(): string {
  const secure = process.env.APP_ENV === "production" ? "; Secure" : "";

  return `${sessionCookieName()}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure}`;
}

export type { CreateSessionCookieOptions, SessionCookieDetails, SignedSession };
export {
  clearSessionCookie,
  createSessionCookie,
  createSessionCookieDetails,
  isSessionInvalidated,
  readSession,
  readSessionUserId,
  SESSION_COOKIE,
  SESSION_REMEMBER_TTL_SECONDS,
  SESSION_TTL_SECONDS,
  sessionCookieName,
  sessionRememberTtlSeconds,
  sessionTtlSeconds,
};
