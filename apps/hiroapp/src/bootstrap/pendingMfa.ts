import { createHmac, timingSafeEqual } from "node:crypto";
import { sessionSecret } from "./config.ts";

const COOKIE = "strata_mfa_pending";

function sign(userId: number, issuedAt: number): string {
  const payload = `${userId}.${issuedAt}`;
  const signature = createHmac("sha256", sessionSecret()).update(payload).digest("hex");
  return `${payload}.${signature}`;
}

export function pendingMfaSetCookie(userId: number): string {
  const issuedAt = Date.now();
  const secure =
    process.env.APP_ENV === "production" || process.env.APP_ENV === "staging" ? "; Secure" : "";
  return `${COOKIE}=${sign(userId, issuedAt)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=600${secure}`;
}

export function pendingMfaClearCookie(): string {
  const secure =
    process.env.APP_ENV === "production" || process.env.APP_ENV === "staging" ? "; Secure" : "";
  return `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure}`;
}

export function readPendingMfaUserId(request: Request): number | null {
  const header = request.headers.get("cookie") ?? "";
  for (const part of header.split(";")) {
    const [name, ...rest] = part.trim().split("=");
    if (name !== COOKIE) {
      continue;
    }
    const value = rest.join("=");
    const pieces = value.split(".");
    if (pieces.length !== 3) {
      return null;
    }
    const userId = Number.parseInt(pieces[0] ?? "", 10);
    const issuedAt = Number.parseInt(pieces[1] ?? "", 10);
    const signature = pieces[2] ?? "";
    if (!Number.isInteger(userId) || userId <= 0 || Date.now() - issuedAt > 10 * 60 * 1000) {
      return null;
    }
    const expected = sign(userId, issuedAt).split(".").pop() ?? "";
    const left = Buffer.from(signature);
    const right = Buffer.from(expected);
    if (left.length !== right.length || !timingSafeEqual(left, right)) {
      return null;
    }
    return userId;
  }
  return null;
}
