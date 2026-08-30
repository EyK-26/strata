import { createHmac, timingSafeEqual } from "node:crypto";
import { appCookieName, appDevSecret } from "../runtime/appKeyPrefix";

const PASSWORD_CONFIRM_COOKIE = "workhub_password_confirmed";
const DEFAULT_PASSWORD_CONFIRM_TTL_SECONDS = 3 * 60 * 60;

function passwordConfirmCookieName(): string {
  return process.env.PASSWORD_CONFIRM_COOKIE_NAME?.trim() || appCookieName("password_confirmed");
}

function passwordConfirmTtlSeconds(): number {
  const parsed = Number.parseInt(process.env.PASSWORD_CONFIRM_TIMEOUT ?? "", 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : DEFAULT_PASSWORD_CONFIRM_TTL_SECONDS;
}

function resolvePasswordConfirmSecret(): string {
  return (
    process.env.SESSION_SECRET?.trim() ||
    process.env.OAUTH_STATE_SECRET?.trim() ||
    appDevSecret("session-secret")
  );
}

function signPasswordConfirm(userId: number, confirmedAt: number): string {
  const payload = `${userId}.${confirmedAt}`;
  const signature = createHmac("sha256", resolvePasswordConfirmSecret())
    .update(payload)
    .digest("hex");

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

function hasFreshPasswordConfirmation(request: Request, userId: number): boolean {
  const cookieValue = readCookieValue(request, passwordConfirmCookieName());

  if (!cookieValue) {
    return false;
  }

  const parts = cookieValue.split(".");

  if (parts.length !== 3) {
    return false;
  }

  const [userIdRaw, confirmedAtRaw, cookieSignature] = parts;
  const cookieUserId = Number.parseInt(String(userIdRaw), 10);
  const confirmedAt = Number.parseInt(String(confirmedAtRaw), 10);

  if (
    cookieUserId !== userId ||
    !Number.isInteger(cookieUserId) ||
    cookieUserId <= 0 ||
    !Number.isFinite(confirmedAt)
  ) {
    return false;
  }

  if (Date.now() - confirmedAt > passwordConfirmTtlSeconds() * 1000) {
    return false;
  }

  const expectedSignature = signPasswordConfirm(cookieUserId, confirmedAt).split(".").pop();

  if (!expectedSignature || !cookieSignature) {
    return false;
  }

  const expectedBuffer = Buffer.from(expectedSignature);
  const actualBuffer = Buffer.from(cookieSignature);

  if (expectedBuffer.length !== actualBuffer.length) {
    return false;
  }

  return timingSafeEqual(expectedBuffer, actualBuffer);
}

function createPasswordConfirmCookie(userId: number): string {
  const confirmedAt = Date.now();
  const value = signPasswordConfirm(userId, confirmedAt);
  const secure = process.env.APP_ENV === "production" ? "; Secure" : "";

  return `${passwordConfirmCookieName()}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${passwordConfirmTtlSeconds()}${secure}`;
}

function clearPasswordConfirmCookie(): string {
  const secure = process.env.APP_ENV === "production" ? "; Secure" : "";

  return `${passwordConfirmCookieName()}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure}`;
}

export {
  clearPasswordConfirmCookie,
  createPasswordConfirmCookie,
  DEFAULT_PASSWORD_CONFIRM_TTL_SECONDS,
  hasFreshPasswordConfirmation,
  PASSWORD_CONFIRM_COOKIE,
  passwordConfirmCookieName,
  passwordConfirmTtlSeconds,
};
