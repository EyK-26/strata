import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { isProductionEnv } from "../runtime/appEnv";
import { requireConfiguredSecret } from "../runtime/appKeyPrefix";

const OAUTH_STATE_COOKIE = "oauth_state";
const OIDC_PKCE_COOKIE = "oidc_pkce";
const OAUTH_STATE_TTL_MS = 10 * 60 * 1000;

interface OidcPkceSeal {
  state: string;
  nonce: string;
  codeVerifier: string;
}

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

function oauthCookieSuffix(): string {
  return `Path=/; HttpOnly; SameSite=Lax${isProductionEnv() ? "; Secure" : ""}`;
}

function sealOidcPkceCookie(payload: OidcPkceSeal): string {
  const body = Buffer.from(
    JSON.stringify({
      state: payload.state,
      nonce: payload.nonce,
      codeVerifier: payload.codeVerifier,
      iat: Date.now(),
    }),
  ).toString("base64url");
  const signature = createHmac("sha256", resolveOAuthStateSecret()).update(body).digest("base64url");
  const value = encodeURIComponent(`${body}.${signature}`);
  return `${OIDC_PKCE_COOKIE}=${value}; ${oauthCookieSuffix()}; Max-Age=600`;
}

function clearOidcPkceCookie(): string {
  return `${OIDC_PKCE_COOKIE}=; ${oauthCookieSuffix()}; Max-Age=0`;
}

function readOidcPkceCookie(
  request: Request,
  returnedState: string | null,
): { nonce: string; codeVerifier: string } | null {
  const state = returnedState?.trim() ?? "";
  if (!state) {
    return null;
  }

  const header = request.headers.get("cookie") ?? "";
  for (const part of header.split(";")) {
    const [name, ...rest] = part.trim().split("=");
    if (name !== OIDC_PKCE_COOKIE) {
      continue;
    }
    return unsealOidcPkceValue(rest.join("="), state);
  }

  return null;
}

function unsealOidcPkceValue(
  rawValue: string,
  returnedState: string,
): { nonce: string; codeVerifier: string } | null {
  let decoded = rawValue;
  try {
    decoded = decodeURIComponent(rawValue);
  } catch {
    return null;
  }

  const splitAt = decoded.lastIndexOf(".");
  if (splitAt <= 0) {
    return null;
  }

  const body = decoded.slice(0, splitAt);
  const signature = decoded.slice(splitAt + 1);
  const expected = createHmac("sha256", resolveOAuthStateSecret()).update(body).digest("base64url");
  const expectedBuffer = Buffer.from(expected);
  const actualBuffer = Buffer.from(signature);
  if (expectedBuffer.length !== actualBuffer.length || !timingSafeEqual(expectedBuffer, actualBuffer)) {
    return null;
  }

  let parsed: { state?: unknown; nonce?: unknown; codeVerifier?: unknown; iat?: unknown };
  try {
    parsed = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as typeof parsed;
  } catch {
    return null;
  }

  if (
    typeof parsed.state !== "string" ||
    typeof parsed.nonce !== "string" ||
    typeof parsed.codeVerifier !== "string" ||
    typeof parsed.iat !== "number" ||
    !parsed.nonce.trim() ||
    !parsed.codeVerifier.trim()
  ) {
    return null;
  }

  if (Date.now() - parsed.iat > OAUTH_STATE_TTL_MS) {
    return null;
  }

  const left = Buffer.from(parsed.state);
  const right = Buffer.from(returnedState);
  if (left.length !== right.length || !timingSafeEqual(left, right)) {
    return null;
  }

  return { nonce: parsed.nonce, codeVerifier: parsed.codeVerifier };
}

export type { OidcPkceSeal };
export {
  clearOAuthStateCookie,
  clearOidcPkceCookie,
  createOAuthState,
  createOAuthStateCookie,
  OAUTH_STATE_COOKIE,
  OIDC_PKCE_COOKIE,
  readOidcPkceCookie,
  sealOidcPkceCookie,
  verifyOAuthState,
  verifySignedOAuthStateValue,
};
