import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { isProductionEnv } from "../runtime/appEnv";
import { requireConfiguredSecret } from "../runtime/appKeyPrefix";

const OAUTH_STATE_COOKIE = "oauth_state";
const OAUTH_STATE_TTL_MS = 10 * 60 * 1000;

function resolveOAuthStateSecret(): string {
  return requireConfiguredSecret(["OAUTH_STATE_SECRET", "SESSION_SECRET"], "oauth-state-secret");
}

function signOAuthState(state: string, issuedAt: number): string {
  const payload = `${state}.${issuedAt}`;
  const signature = createHmac("sha256", resolveOAuthStateSecret()).update(payload).digest("hex");

  return `${payload}.${signature}`;
}

function verifySignedOAuthStateValue(value: string): boolean {
  const parts = value.split(".");

  if (parts.length !== 3) {
    return false;
  }

  const [nonce, issuedAtRaw, signature] = parts;

  if (!nonce || !issuedAtRaw || !signature) {
    return false;
  }

  const issuedAt = Number.parseInt(issuedAtRaw, 10);

  if (!Number.isFinite(issuedAt)) {
    return false;
  }

  if (Date.now() - issuedAt > OAUTH_STATE_TTL_MS) {
    return false;
  }

  const expectedSignature = signOAuthState(nonce, issuedAt).split(".").at(-1) ?? "";
  const expectedBuffer = Buffer.from(expectedSignature);
  const actualBuffer = Buffer.from(signature);

  if (expectedBuffer.length !== actualBuffer.length) {
    return false;
  }

  return timingSafeEqual(expectedBuffer, actualBuffer);
}

function createOAuthState(): { state: string } {
  const nonce = randomBytes(24).toString("hex");
  const issuedAt = Date.now();

  return { state: signOAuthState(nonce, issuedAt) };
}

function createOAuthStateCookie(): { state: string; cookie: string } {
  const { state } = createOAuthState();

  return {
    state,
    cookie: `${OAUTH_STATE_COOKIE}=${encodeURIComponent(state)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=600${isProductionEnv() ? "; Secure" : ""}`,
  };
}

function verifyOAuthState(_request: Request, returnedState: string | null): boolean {
  if (!returnedState || returnedState.trim().length === 0) {
    return false;
  }

  return verifySignedOAuthStateValue(returnedState.trim());
}

function clearOAuthStateCookie(): string {
  return `${OAUTH_STATE_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${isProductionEnv() ? "; Secure" : ""}`;
}

export {
  clearOAuthStateCookie,
  createOAuthState,
  createOAuthStateCookie,
  OAUTH_STATE_COOKIE,
  verifyOAuthState,
  verifySignedOAuthStateValue,
};
