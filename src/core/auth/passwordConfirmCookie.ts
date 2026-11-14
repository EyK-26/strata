import { createHmac, timingSafeEqual } from "node:crypto";
import { resolveEnv } from "../config/envSchema";
import { readRequestCookie } from "../http/cookies";
import { isProductionEnv } from "../runtime/appEnv";
import { appCookieName, requireConfiguredSecret } from "../runtime/appKeyPrefix";
import { matchesAuthVersion } from "./accountState";

const PASSWORD_CONFIRM_COOKIE = "strata_password_confirmed";
const DEFAULT_PASSWORD_CONFIRM_TTL_SECONDS = 3 * 60 * 60;

function passwordConfirmCookieName(env: Readonly<Record<string, string | undefined>>): string {
  return env.PASSWORD_CONFIRM_COOKIE_NAME?.trim() || appCookieName("password_confirmed", env);
}

function passwordConfirmTtlSeconds(env: Readonly<Record<string, string | undefined>>): number {
  return resolveEnv(
    {
      PASSWORD_CONFIRM_TIMEOUT: {
        integer: true,
        minimum: 1,
        default: String(DEFAULT_PASSWORD_CONFIRM_TTL_SECONDS),
      },
    },
    env,
  ).PASSWORD_CONFIRM_TIMEOUT;
}

export function passwordConfirmOptionsFromEnvironment(
  env: Readonly<Record<string, string | undefined>>,
): PasswordConfirmWriteOptions {
  return Object.freeze({
    cookieName: passwordConfirmCookieName(env),
    ttlSeconds: passwordConfirmTtlSeconds(env),
    production: isProductionEnv(env),
    secret: requireConfiguredSecret(
      ["SESSION_SECRET", "OAUTH_STATE_SECRET"],
      "session-secret",
      env,
    ),
  });
}
export interface PasswordConfirmReadOptions {
  readonly secret: string;
  readonly cookieName: string;
  readonly ttlSeconds: number;
}
export interface PasswordConfirmWriteOptions extends PasswordConfirmReadOptions {
  readonly production: boolean;
}
function missingPasswordConfirmSecret(): never {
  throw new TypeError("Explicit password confirmation secret is required.");
}
function signPasswordConfirm(
  userId: number,
  confirmedAt: number,
  authVersion?: number,
  secret?: string,
): string {
  const payload =
    authVersion === undefined
      ? `${userId}.${confirmedAt}`
      : `v2.${userId}.${confirmedAt}.${authVersion}`;
  const signature = createHmac("sha256", secret ?? missingPasswordConfirmSecret())
    .update(payload)
    .digest("hex");

  return `${payload}.${signature}`;
}

function hasFreshPasswordConfirmation(
  request: Request,
  userId: number,
  authVersion: number | undefined,
  options: PasswordConfirmReadOptions,
): boolean {
  const cookieValue = readRequestCookie(request, options.cookieName);

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

  if (Date.now() - confirmedAt > options.ttlSeconds * 1000) {
    return false;
  }

  const expectedSignature = signPasswordConfirm(
    cookieUserId,
    confirmedAt,
    proofVersion,
    options.secret,
  )
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

function createPasswordConfirmCookie(
  userId: number,
  authVersion: number | undefined,
  options: PasswordConfirmWriteOptions,
): string {
  if (authVersion !== undefined && (!Number.isSafeInteger(authVersion) || authVersion < 0))
    throw new Error("Invalid authentication version.");
  const confirmedAt = Date.now();
  const value = signPasswordConfirm(userId, confirmedAt, authVersion, options.secret);
  const secure = options.production ? "; Secure" : "";

  return `${options.cookieName}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${options.ttlSeconds}${secure}`;
}

function clearPasswordConfirmCookie(
  options: Pick<PasswordConfirmWriteOptions, "production" | "cookieName">,
): string {
  const secure = options.production ? "; Secure" : "";

  return `${options.cookieName}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure}`;
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
