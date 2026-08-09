import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

const OAUTH_STATE_COOKIE = "oauth_state";
const OAUTH_STATE_TTL_MS = 10 * 60 * 1000;

function resolveOAuthStateSecret(): string {
  return (
    process.env.OAUTH_STATE_SECRET?.trim() ||
    process.env.ADMIN_API_TOKEN?.trim() ||
    "workhub-dev-oauth-state-secret"
  );
}

function signOAuthState(state: string, issuedAt: number): string {
  const payload = `${state}.${issuedAt}`;
  const signature = createHmac("sha256", resolveOAuthStateSecret()).update(payload).digest("hex");

  return `${payload}.${signature}`;
}

function createOAuthStateCookie(): { state: string; cookie: string } {
  const state = randomBytes(24).toString("hex");
  const issuedAt = Date.now();
  const value = signOAuthState(state, issuedAt);

  return {
    state,
    cookie: `${OAUTH_STATE_COOKIE}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=600`,
  };
}

function readOAuthStateCookie(request: Request): string | null {
  const cookieHeader = request.headers.get("cookie");

  if (!cookieHeader) {
    return null;
  }

  for (const part of cookieHeader.split(";")) {
    const [name, ...rest] = part.trim().split("=");

    if (name === OAUTH_STATE_COOKIE) {
      return decodeURIComponent(rest.join("="));
    }
  }

  return null;
}

function verifyOAuthState(request: Request, returnedState: string | null): boolean {
  if (!returnedState || returnedState.trim().length === 0) {
    return false;
  }

  const cookieValue = readOAuthStateCookie(request);

  if (!cookieValue) {
    return false;
  }

  const parts = cookieValue.split(".");

  if (parts.length !== 3) {
    return false;
  }

  const [cookieState, issuedAtRaw, cookieSignature] = parts;

  if (!cookieState || !issuedAtRaw || !cookieSignature) {
    return false;
  }

  const issuedAt = Number.parseInt(issuedAtRaw, 10);

  if (cookieState !== returnedState || !Number.isFinite(issuedAt)) {
    return false;
  }

  if (Date.now() - issuedAt > OAUTH_STATE_TTL_MS) {
    return false;
  }

  const expectedSignature = signOAuthState(cookieState, issuedAt).split(".").pop()!;

  const expectedBuffer = Buffer.from(expectedSignature);
  const actualBuffer = Buffer.from(cookieSignature);

  if (expectedBuffer.length !== actualBuffer.length) {
    return false;
  }

  return timingSafeEqual(expectedBuffer, actualBuffer);
}

function clearOAuthStateCookie(): string {
  return `${OAUTH_STATE_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
}

export { clearOAuthStateCookie, createOAuthStateCookie, OAUTH_STATE_COOKIE, verifyOAuthState };
