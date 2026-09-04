import { createHmac, timingSafeEqual } from "node:crypto";
import { appCookieName, appDevSecret } from "@getstrata/core/runtime/appKeyPrefix";

const MFA_CHALLENGE_COOKIE = appCookieName("mfa_pending");
const DEFAULT_MFA_CHALLENGE_TTL_SECONDS = 10 * 60;

interface MfaChallenge {
  userId: number;
}

function mfaChallengeCookieName(): string {
  return process.env.MFA_CHALLENGE_COOKIE_NAME?.trim() || MFA_CHALLENGE_COOKIE;
}

function mfaChallengeTtlSeconds(): number {
  const parsed = Number.parseInt(process.env.MFA_CHALLENGE_TTL_SECONDS ?? "", 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : DEFAULT_MFA_CHALLENGE_TTL_SECONDS;
}

function resolveMfaChallengeSecret(): string {
  return process.env.SESSION_SECRET?.trim() || appDevSecret("session-secret");
}

function signMfaChallenge(userId: number, issuedAt: number): string {
  const payload = `${userId}.${issuedAt}`;
  const signature = createHmac("sha256", resolveMfaChallengeSecret()).update(payload).digest("hex");
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

function readMfaChallenge(request: Request): MfaChallenge | null {
  const cookieValue = readCookieValue(request, mfaChallengeCookieName());
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
  if (Date.now() - issuedAt > mfaChallengeTtlSeconds() * 1000) {
    return null;
  }
  const expectedSignature = signMfaChallenge(userId, issuedAt).split(".").pop();
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
  return { userId };
}

function createMfaChallengeCookie(userId: number): string {
  const issuedAt = Date.now();
  const value = signMfaChallenge(userId, issuedAt);
  const secure = process.env.APP_ENV === "production" ? "; Secure" : "";
  return `${mfaChallengeCookieName()}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${mfaChallengeTtlSeconds()}${secure}`;
}

function clearMfaChallengeCookie(): string {
  const secure = process.env.APP_ENV === "production" ? "; Secure" : "";
  return `${mfaChallengeCookieName()}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure}`;
}

export type { MfaChallenge };
export {
  clearMfaChallengeCookie,
  createMfaChallengeCookie,
  MFA_CHALLENGE_COOKIE,
  readMfaChallenge,
};
