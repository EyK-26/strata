import { createHmac, timingSafeEqual } from "node:crypto";
import { isProductionEnv } from "../runtime/appEnv";
import { appCookieName, requireConfiguredSecret } from "../runtime/appKeyPrefix";

const FLASH_COOKIE = "strata_flash";
const FLASH_TTL_MS = 60 * 1000;

export interface FlashSessionOptions {
  readonly cookieName: string;
  readonly secret: string;
  readonly production: boolean;
}
export function flashSessionOptionsFromEnvironment(
  env: Readonly<Record<string, string | undefined>>,
): FlashSessionOptions {
  return Object.freeze({
    cookieName: flashCookieName(env),
    secret: requireConfiguredSecret(["SESSION_SECRET", "OAUTH_STATE_SECRET"], "flash-secret", env),
    production: isProductionEnv(env),
  });
}
function flashCookieName(env: Readonly<Record<string, string | undefined>>): string {
  return env.FLASH_COOKIE_NAME?.trim() || appCookieName("flash", env);
}

type FlashLevel = "success" | "error" | "info";

interface FlashMessage {
  level: FlashLevel;
  message: string;
}

function signFlashPayload(payload: string, issuedAt: number, options: FlashSessionOptions): string {
  const signature = createHmac("sha256", options.secret)
    .update(`${payload}.${issuedAt}`)
    .digest("hex");

  return `${payload}.${issuedAt}.${signature}`;
}

function readFlashCookie(request: Request, options: FlashSessionOptions): string | null {
  const cookieHeader = request.headers.get("cookie");

  if (!cookieHeader) {
    return null;
  }

  for (const part of cookieHeader.split(";")) {
    const [name, ...rest] = part.trim().split("=");

    if (name === options.cookieName) {
      return decodeURIComponent(rest.join("="));
    }
  }

  return null;
}

function parseFlashCookie(cookieValue: string, options: FlashSessionOptions): FlashMessage | null {
  const parts = cookieValue.split(".");

  if (parts.length < 3) {
    return null;
  }

  const signature = parts.pop();
  const issuedAtRaw = parts.pop();
  const payload = parts.join(".");

  if (!signature || !issuedAtRaw || !payload) {
    return null;
  }

  const issuedAt = Number.parseInt(issuedAtRaw, 10);

  if (!Number.isFinite(issuedAt) || Date.now() - issuedAt > FLASH_TTL_MS) {
    return null;
  }

  const expectedSignature = signFlashPayload(payload, issuedAt, options).split(".").pop();

  if (!expectedSignature) {
    return null;
  }

  const expectedBuffer = Buffer.from(expectedSignature);
  const actualBuffer = Buffer.from(signature);

  if (expectedBuffer.length !== actualBuffer.length) {
    return null;
  }

  if (!timingSafeEqual(expectedBuffer, actualBuffer)) {
    return null;
  }

  try {
    const parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as FlashMessage;

    if (!parsed?.message || typeof parsed.message !== "string") {
      return null;
    }

    if (parsed.level !== "success" && parsed.level !== "error" && parsed.level !== "info") {
      return null;
    }

    return parsed;
  } catch {
    return null;
  }
}

function createFlashCookie(message: FlashMessage, options: FlashSessionOptions): string {
  const payload = Buffer.from(JSON.stringify(message), "utf8").toString("base64url");
  const issuedAt = Date.now();
  const value = signFlashPayload(payload, issuedAt, options);

  const secure = options.production ? "; Secure" : "";
  return `${options.cookieName}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=60${secure}`;
}

function clearFlashCookie(options: FlashSessionOptions): string {
  const secure = options.production ? "; Secure" : "";
  return `${options.cookieName}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure}`;
}

function pullFlash(request: Request, options: FlashSessionOptions): FlashMessage | null {
  const cookieValue = readFlashCookie(request, options);

  if (!cookieValue) {
    return null;
  }

  return parseFlashCookie(cookieValue, options);
}

function flashResponse(
  response: Response,
  message: FlashMessage,
  options: FlashSessionOptions,
): Response {
  const headers = new Headers(response.headers);
  headers.append("set-cookie", createFlashCookie(message, options));

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

function withFlashClear(response: Response, options: FlashSessionOptions): Response {
  const headers = new Headers(response.headers);
  headers.append("set-cookie", clearFlashCookie(options));

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

export type { FlashLevel, FlashMessage };
export {
  clearFlashCookie,
  createFlashCookie,
  FLASH_COOKIE,
  flashCookieName,
  flashResponse,
  pullFlash,
  withFlashClear,
};
