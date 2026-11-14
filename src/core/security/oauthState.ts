import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { readRequestCookie } from "../http/cookies";
import { isProductionEnv } from "../runtime/appEnv";
import { requireConfiguredSecret } from "../runtime/appKeyPrefix";

const OAUTH_STATE_COOKIE = "oauth_state";
const SAML_STATE_COOKIE = "saml_state";
const OIDC_PKCE_COOKIE = "oidc_pkce";
const OAUTH_STATE_TTL_MS = 10 * 60 * 1000;

interface OAuthStateOptions {
  readonly secret: string;
  readonly production: boolean;
}

interface OidcPkceSeal {
  state: string;
  nonce: string;
  codeVerifier: string;
}

function resolveOAuthStateSecret(): string {
  return requireConfiguredSecret(["OAUTH_STATE_SECRET", "SESSION_SECRET"], "oauth-state-secret");
}

function signOAuthState(state: string, issuedAt: number, options?: OAuthStateOptions): string {
  const payload = `${state}.${issuedAt}`;
  const signature = createHmac("sha256", options?.secret ?? resolveOAuthStateSecret())
    .update(payload)
    .digest("hex");

  return `${payload}.${signature}`;
}

/** Validate the signature and lifetime only; browser binding must be supplied separately. */
function verifySignedOAuthStateValue(value: string, options?: OAuthStateOptions): boolean {
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

  const expectedSignature = signOAuthState(nonce, issuedAt, options).split(".").at(-1) ?? "";
  const expectedBuffer = Buffer.from(expectedSignature);
  const actualBuffer = Buffer.from(signature);

  if (expectedBuffer.length !== actualBuffer.length) {
    return false;
  }

  return timingSafeEqual(expectedBuffer, actualBuffer);
}

function createOAuthState(options?: OAuthStateOptions): { state: string } {
  const nonce = randomBytes(24).toString("hex");
  const issuedAt = Date.now();

  return { state: signOAuthState(nonce, issuedAt, options) };
}

function createOAuthStateCookie(options?: OAuthStateOptions): { state: string; cookie: string } {
  const { state } = createOAuthState(options);

  return {
    state,
    cookie: `${OAUTH_STATE_COOKIE}=${encodeURIComponent(state)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=600${(options?.production ?? isProductionEnv()) ? "; Secure" : ""}`,
  };
}

/** Require signed state to match the initiating browser's OAuth state cookie. */
function verifyOAuthState(
  request: Request,
  returnedState: string | null,
  options?: OAuthStateOptions,
): boolean {
  return verifyBrowserState(request, returnedState, OAUTH_STATE_COOKIE, options);
}

function verifyBrowserState(
  request: Request,
  returnedState: string | null,
  cookieName: string,
  options?: OAuthStateOptions,
): boolean {
  if (!returnedState || returnedState.trim().length === 0) {
    return false;
  }

  const state = returnedState.trim();
  const cookie = readRequestCookie(request, cookieName);
  if (!cookie) return false;
  const expected = Buffer.from(cookie);
  const actual = Buffer.from(state);
  return (
    expected.length === actual.length &&
    timingSafeEqual(expected, actual) &&
    verifySignedOAuthStateValue(state, options)
  );
}

/** Cross-site IdP POSTs require SameSite=None; browsers require Secure and HTTPS. */
function createSamlStateCookie(options?: OAuthStateOptions): { state: string; cookie: string } {
  const { state } = createOAuthState(options);
  return {
    state,
    cookie: `${SAML_STATE_COOKIE}=${encodeURIComponent(state)}; Path=/; HttpOnly; SameSite=None; Max-Age=600; Secure`,
  };
}

function verifySamlState(
  request: Request,
  returnedState: string | null,
  options?: OAuthStateOptions,
): boolean {
  return verifyBrowserState(request, returnedState, SAML_STATE_COOKIE, options);
}

function clearSamlStateCookie(): string {
  return `${SAML_STATE_COOKIE}=; Path=/; HttpOnly; SameSite=None; Max-Age=0; Secure`;
}

function clearOAuthStateCookie(options?: OAuthStateOptions): string {
  return `${OAUTH_STATE_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${(options?.production ?? isProductionEnv()) ? "; Secure" : ""}`;
}

function oauthCookieSuffix(options?: OAuthStateOptions): string {
  return `Path=/; HttpOnly; SameSite=Lax${(options?.production ?? isProductionEnv()) ? "; Secure" : ""}`;
}

function sealOidcPkceCookie(payload: OidcPkceSeal, options?: OAuthStateOptions): string {
  const body = Buffer.from(
    JSON.stringify({
      state: payload.state,
      nonce: payload.nonce,
      codeVerifier: payload.codeVerifier,
      iat: Date.now(),
    }),
  ).toString("base64url");
  const signature = createHmac("sha256", options?.secret ?? resolveOAuthStateSecret())
    .update(body)
    .digest("base64url");
  const value = encodeURIComponent(`${body}.${signature}`);
  return `${OIDC_PKCE_COOKIE}=${value}; ${oauthCookieSuffix(options)}; Max-Age=600`;
}

function clearOidcPkceCookie(options?: OAuthStateOptions): string {
  return `${OIDC_PKCE_COOKIE}=; ${oauthCookieSuffix(options)}; Max-Age=0`;
}

function readOidcPkceCookie(
  request: Request,
  returnedState: string | null,
  options?: OAuthStateOptions,
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
    return unsealOidcPkceValue(rest.join("="), state, options);
  }

  return null;
}

function unsealOidcPkceValue(
  rawValue: string,
  returnedState: string,
  options?: OAuthStateOptions,
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
  const expected = createHmac("sha256", options?.secret ?? resolveOAuthStateSecret())
    .update(body)
    .digest("base64url");
  const expectedBuffer = Buffer.from(expected);
  const actualBuffer = Buffer.from(signature);
  if (
    expectedBuffer.length !== actualBuffer.length ||
    !timingSafeEqual(expectedBuffer, actualBuffer)
  ) {
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

export type { OAuthStateOptions, OidcPkceSeal };
export {
  clearOAuthStateCookie,
  clearOidcPkceCookie,
  clearSamlStateCookie,
  createOAuthState,
  createOAuthStateCookie,
  createSamlStateCookie,
  OAUTH_STATE_COOKIE,
  OIDC_PKCE_COOKIE,
  readOidcPkceCookie,
  SAML_STATE_COOKIE,
  sealOidcPkceCookie,
  verifyOAuthState,
  verifySamlState,
  verifySignedOAuthStateValue,
};
