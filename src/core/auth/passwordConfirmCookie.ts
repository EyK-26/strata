import { createHmac, timingSafeEqual } from "node:crypto";
import { readRequestCookie } from "../http/cookies";
import { isProductionEnv } from "../runtime/appEnv";
import { appCookieName, requireConfiguredSecret } from "../runtime/appKeyPrefix";
import { matchesAuthVersion } from "./accountState";

const PASSWORD_CONFIRM_COOKIE = appCookieName("password_confirmed");
const DEFAULT_PASSWORD_CONFIRM_TTL_SECONDS = 3 * 60 * 60;

function passwordConfirmCookieName(): string {
  return process.env.PASSWORD_CONFIRM_COOKIE_NAME?.trim() || appCookieName("password_confirmed");
}

function passwordConfirmTtlSeconds(): number {
  const parsed = Number.parseInt(process.env.PASSWORD_CONFIRM_TIMEOUT ?? "", 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : DEFAULT_PASSWORD_CONFIRM_TTL_SECONDS;
}

function resolvePasswordConfirmSecret(): string {
  return requireConfiguredSecret(["SESSION_SECRET", "OAUTH_STATE_SECRET"], "session-secret");
}

function signPasswordConfirm(userId: number, confirmedAt: number, authVersion?: number): string {
  const payload =
    authVersion === undefined
      ? `${userId}.${confirmedAt}`
      : `v2.${userId}.${confirmedAt}.${authVersion}`;
  const signature = createHmac("sha256", resolvePasswordConfirmSecret())
    .update(payload)
    .digest("hex");

  return `${payload}.${signature}`;
}

function hasFreshPasswordConfirmation(
  request: Request,
  userId: number,
  authVersion?: number,
): boolean {
  const cookieValue = readRequestCookie(request, passwordConfirmCookieName());

  if (!cookieValue) {
    return false;
  }

  const parts = cookieValue.split(".");

  let proofVersion: number | undefined;
  if (parts.length === 5 && parts[0] === "v2") {
    if (
      parts
        .slice(1, 4)
        .some((value) => !/^(0|[1-9][0-9]*)$/.test(value) || !Number.isSafeInteger(Number(value)))
    )
      return false;
    proofVersion = Number(parts[3]);
    parts.splice(3, 1);
    parts.shift();
  }
  if (parts.length !== 3 || !matchesAuthVersion(proofVersion, authVersion)) return false;
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

  const expectedSignature = signPasswordConfirm(cookieUserId, confirmedAt, proofVersion)
    .split(".")
    .pop();

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

function createPasswordConfirmCookie(userId: number, authVersion?: number): string {
  if (authVersion !== undefined && (!Number.isSafeInteger(authVersion) || authVersion < 0))
    throw new Error("Invalid authentication version.");
  const confirmedAt = Date.now();
  const value = signPasswordConfirm(userId, confirmedAt, authVersion);
  const secure = isProductionEnv() ? "; Secure" : "";

  return `${passwordConfirmCookieName()}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${passwordConfirmTtlSeconds()}${secure}`;
}

function clearPasswordConfirmCookie(): string {
  const secure = isProductionEnv() ? "; Secure" : "";

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
