import { createHmac, timingSafeEqual } from "node:crypto";
import { readRequestCookie } from "../http/cookies";
import { isProductionEnv } from "../runtime/appEnv";

const COOKIE = "strata_mfa_pending";
const TTL = 600;
interface PendingMfaChallenge {
  userId: number;
  authVersion: number;
}

function signature(payload: string, secret: string): string {
  if (!secret.trim()) throw new Error("A pending MFA secret is required.");
  return createHmac("sha256", secret).update(`pending-mfa:${payload}`).digest("hex");
}
function header(value: string, ttl: number): string {
  return `${COOKIE}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${ttl}${isProductionEnv() ? "; Secure" : ""}`;
}
function createPendingMfaCookie(userId: number, authVersion: number, secret: string): string {
  if (
    !Number.isSafeInteger(userId) ||
    userId <= 0 ||
    !Number.isSafeInteger(authVersion) ||
    authVersion < 0
  )
    throw new Error("Invalid pending MFA account identity or version.");
  const payload = `v1.${userId}.${authVersion}.${Date.now()}`;
  return header(`${payload}.${signature(payload, secret)}`, TTL);
}
function readPendingMfaCookie(request: Request, secret: string): PendingMfaChallenge | null {
  const value = readRequestCookie(request, COOKIE);
  if (!value) return null;
  const parts = value.split(".");
  if (parts.length !== 5 || parts[0] !== "v1") return null;
  const fields = parts.slice(1, 4);
  if (fields.some((part) => !/^(0|[1-9][0-9]*)$/.test(part) || !Number.isSafeInteger(Number(part))))
    return null;
  const userId = Number(parts[1]),
    authVersion = Number(parts[2]),
    issuedAt = Number(parts[3]);
  if (userId <= 0 || issuedAt > Date.now() || Date.now() - issuedAt > TTL * 1000) return null;
  const expected = Buffer.from(signature(parts.slice(0, 4).join("."), secret));
  const actual = Buffer.from(parts[4] ?? "");
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return null;
  return { userId, authVersion };
}
function clearPendingMfaCookie(): string {
  return header("", 0);
}

export type { PendingMfaChallenge };
export { clearPendingMfaCookie, createPendingMfaCookie, readPendingMfaCookie };
