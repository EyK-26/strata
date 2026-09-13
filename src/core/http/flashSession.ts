import { createHmac, timingSafeEqual } from "node:crypto";
import { isProductionEnv } from "../runtime/appEnv";
import { appCookieName, requireConfiguredSecret } from "../runtime/appKeyPrefix";

const FLASH_COOKIE = appCookieName("flash");
const FLASH_TTL_MS = 60 * 1000;

function flashCookieName(): string {
  return process.env.FLASH_COOKIE_NAME?.trim() || appCookieName("flash");
}

type FlashLevel = "success" | "error" | "info";

interface FlashMessage {
  level: FlashLevel;
  message: string;
}

function resolveFlashSecret(): string {
  return requireConfiguredSecret(["SESSION_SECRET", "OAUTH_STATE_SECRET"], "flash-secret");
}

function signFlashPayload(payload: string, issuedAt: number): string {
  const signature = createHmac("sha256", resolveFlashSecret())
    .update(`${payload}.${issuedAt}`)
    .digest("hex");

  return `${payload}.${issuedAt}.${signature}`;
}

function readFlashCookie(request: Request): string | null {
  const cookieHeader = request.headers.get("cookie");

  if (!cookieHeader) {
    return null;
  }

  for (const part of cookieHeader.split(";")) {
    const [name, ...rest] = part.trim().split("=");

    if (name === flashCookieName()) {
      return decodeURIComponent(rest.join("="));
    }
  }

  return null;
}

function parseFlashCookie(cookieValue: string): FlashMessage | null {
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

  const expectedSignature = signFlashPayload(payload, issuedAt).split(".").pop();

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

function createFlashCookie(message: FlashMessage): string {
  const payload = Buffer.from(JSON.stringify(message), "utf8").toString("base64url");
  const issuedAt = Date.now();
  const value = signFlashPayload(payload, issuedAt);

  const secure = isProductionEnv() ? "; Secure" : "";
  return `${flashCookieName()}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=60${secure}`;
}

function clearFlashCookie(): string {
  const secure = isProductionEnv() ? "; Secure" : "";
  return `${flashCookieName()}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure}`;
}

function pullFlash(request: Request): FlashMessage | null {
  const cookieValue = readFlashCookie(request);

  if (!cookieValue) {
    return null;
  }

  return parseFlashCookie(cookieValue);
}

function flashResponse(response: Response, message: FlashMessage): Response {
  const headers = new Headers(response.headers);
  headers.append("set-cookie", createFlashCookie(message));

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

function withFlashClear(response: Response): Response {
  const headers = new Headers(response.headers);
  headers.append("set-cookie", clearFlashCookie());

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
