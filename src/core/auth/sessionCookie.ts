import { createHmac, timingSafeEqual } from "node:crypto";
import { readRequestCookie } from "../http/cookies";
import { isProductionEnv } from "../runtime/appEnv";
import { appCookieName, requireConfiguredSecret } from "../runtime/appKeyPrefix";

const SESSION_COOKIE = appCookieName("session");
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 7;
const SESSION_REMEMBER_TTL_SECONDS = 60 * 60 * 24 * 30;

interface CreateSessionCookieOptions {
  remember?: boolean;
  authVersion?: number;
}

interface SignedSession {
  userId: number;
  issuedAt: number;
  authVersion?: number;
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
  return requireConfiguredSecret(["SESSION_SECRET"], "session-secret");
}

function signSession(
  userId: number,
  issuedAt: number,
  ttlSeconds?: number,
  authVersion?: number,
): string {
  const payload =
    authVersion !== undefined
      ? `v2.${userId}.${issuedAt}.${ttlSeconds}.${authVersion}`
      : ttlSeconds === undefined
        ? `${userId}.${issuedAt}`
        : `${userId}.${issuedAt}.${ttlSeconds}`;
  const signature = createHmac("sha256", resolveSessionSecret()).update(payload).digest("hex");

  return `${payload}.${signature}`;
}

function readSignedSession(
  userIdRaw: string,
  issuedAtRaw: string,
  cookieSignature: string | undefined,
  ttlSeconds: number,
  remember: boolean,
  authVersion?: number,
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
    authVersion !== undefined
      ? signSession(userId, issuedAt, ttlSeconds, authVersion)
      : remember
        ? signSession(userId, issuedAt, ttlSeconds)
        : signSession(userId, issuedAt)
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

  return { userId, issuedAt, ...(authVersion !== undefined ? { authVersion } : {}) };
}

function readSession(request: Request): SignedSession | null {
  const cookieValue = readRequestCookie(request, sessionCookieName());

  if (!cookieValue) {
    return null;
  }

  const parts = cookieValue.split(".");

  if (parts.length === 6 && parts[0] === "v2") {
    const fields = parts.slice(1, 5);
    if (
      fields.some(
        (value) => !/^(0|[1-9][0-9]*)$/.test(value) || !Number.isSafeInteger(Number(value)),
      )
    )
      return null;
    return readSignedSession(
      String(parts[1]),
      String(parts[2]),
      parts[5],
      Number(parts[3]),
      true,
      Number(parts[4]),
    );
  }

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
  authVersion?: number;
  header: string;
  userId: number;
  issuedAt: number;
  ttlSeconds: number;
}

function createSessionCookieDetails(
  userId: number,
  options: CreateSessionCookieOptions = {},
): SessionCookieDetails {
  if (
    options.authVersion !== undefined &&
    (!Number.isSafeInteger(options.authVersion) || options.authVersion < 0)
  )
    throw new RangeError("authVersion must be a non-negative safe integer.");
  const issuedAt = Date.now();
  const ttlSeconds = options.remember ? sessionRememberTtlSeconds() : sessionTtlSeconds();
  const value =
    options.authVersion !== undefined
      ? signSession(userId, issuedAt, ttlSeconds, options.authVersion)
      : options.remember
        ? signSession(userId, issuedAt, ttlSeconds)
        : signSession(userId, issuedAt);
  const secure = isProductionEnv() ? "; Secure" : "";

  return {
    header: `${sessionCookieName()}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${ttlSeconds}${secure}`,
    userId,
    issuedAt,
    ttlSeconds,
    ...(options.authVersion !== undefined ? { authVersion: options.authVersion } : {}),
  };
}

function createSessionCookie(userId: number, options: CreateSessionCookieOptions = {}): string {
  return createSessionCookieDetails(userId, options).header;
}

function clearSessionCookie(): string {
  const secure = isProductionEnv() ? "; Secure" : "";

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
