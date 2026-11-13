import { createHash, createPublicKey, createVerify, type KeyObject } from "node:crypto";
import { safeFetch } from "../../security/safeFetch";
import { timingSafeCompareString } from "../../security/timingSafeCompare";
import type { JwtPayload } from "../jwt";

interface OidcDiscovery {
  readonly issuer?: string;
  readonly authorization_endpoint: string;
  readonly token_endpoint: string;
  readonly jwks_uri: string;
}

interface JsonWebKeyLike {
  kty?: string;
  kid?: string;
  alg?: string;
  use?: string;
  n?: string;
  e?: string;
}

const JWKS_TTL_MS = 60 * 60 * 1000;
interface OidcNetworkPolicy {
  readonly production: boolean;
  readonly allowPrivate?: boolean;
}
interface OidcClient {
  loadDiscovery(issuer: string): Promise<OidcDiscovery>;
  verifyIdToken(token: string, options: OidcVerificationOptions): Promise<JwtPayload>;
  fetchOptions(url: string): ReturnType<typeof oidcSafeFetchOptions>;
}
interface OidcState {
  readonly policy: OidcNetworkPolicy;
  readonly discoveryCache: Map<string, { discovery: OidcDiscovery; fetchedAt: number }>;
  readonly jwksCache: Map<string, { keys: JsonWebKeyLike[]; fetchedAt: number }>;
}
interface OidcVerificationOptions {
  issuer: string;
  clientId: string;
  nonce: string;
  jwksUri: string;
  accessToken?: string;
}
function createOidcClient(input: OidcNetworkPolicy = { production: true }): OidcClient {
  if (
    typeof input.production !== "boolean" ||
    (input.allowPrivate !== undefined && typeof input.allowPrivate !== "boolean")
  )
    throw new TypeError("OIDC requires an explicit valid network policy.");
  const state: OidcState = {
    policy: Object.freeze({ ...input }),
    discoveryCache: new Map(),
    jwksCache: new Map(),
  };
  return Object.freeze({
    loadDiscovery: (issuer: string) => loadOidcDiscovery(issuer, state),
    verifyIdToken: (token: string, options: OidcVerificationOptions) =>
      verifyOidcIdToken(token, options, state),
    fetchOptions: (url: string) => oidcSafeFetchOptions(url, state.policy),
  });
}

function issuerOrigin(issuer: string): string {
  return issuer.replace(/\/$/, "");
}

function oidcLoopbackHost(hostname: string): boolean {
  const host = hostname
    .trim()
    .toLowerCase()
    .replace(/^\[|\]$/gu, "");
  return host === "localhost" || host === "127.0.0.1" || host === "::1";
}

/**
 * Loopback issuers work in local/dev without an extra flag. Other private hosts
 * require the captured allowPrivate policy. Production always blocks private hosts.
 */
function oidcOutboundAllowsPrivate(url: string, policy: OidcNetworkPolicy): boolean {
  if (policy.production) {
    return false;
  }
  if (policy.allowPrivate) {
    return true;
  }
  try {
    return oidcLoopbackHost(new URL(url).hostname);
  } catch {
    return false;
  }
}

function oidcSafeFetchOptions(
  url: string,
  policy: OidcNetworkPolicy,
): {
  production: boolean;
  allowHttp: boolean;
  allowPrivate: boolean;
  timeoutMs: number;
  maxRedirects: number;
} {
  return {
    production: policy.production,
    allowHttp: !policy.production,
    allowPrivate: oidcOutboundAllowsPrivate(url, policy),
    timeoutMs: 10_000,
    maxRedirects: 0,
  };
}

async function fetchJson(url: string, state: OidcState): Promise<unknown> {
  const response = await safeFetch(
    url,
    { headers: { accept: "application/json" } },
    oidcSafeFetchOptions(url, state.policy),
  );

  return await response.json();
}

async function loadOidcDiscovery(issuer: string, state: OidcState): Promise<OidcDiscovery> {
  const key = issuerOrigin(issuer);
  const cached = state.discoveryCache.get(key);
  if (cached && Date.now() - cached.fetchedAt < JWKS_TTL_MS) {
    return cached.discovery;
  }

  const raw = await fetchJson(`${key}/.well-known/openid-configuration`, state);
  const document =
    raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const { authorization_endpoint, token_endpoint, jwks_uri, issuer: declaredIssuer } = document;
  if (
    typeof authorization_endpoint !== "string" ||
    !authorization_endpoint.trim() ||
    typeof token_endpoint !== "string" ||
    !token_endpoint.trim() ||
    typeof jwks_uri !== "string" ||
    !jwks_uri.trim()
  ) {
    throw new Error(
      "OIDC discovery document did not include authorization_endpoint, jwks_uri, and token_endpoint.",
    );
  }
  // Public clients share this cache entry: retain only validated immutable strings.
  const discovery: OidcDiscovery = Object.freeze({
    ...(typeof declaredIssuer === "string" ? { issuer: declaredIssuer } : {}),
    authorization_endpoint: authorization_endpoint.trim(),
    token_endpoint: token_endpoint.trim(),
    jwks_uri: jwks_uri.trim(),
  });

  state.discoveryCache.set(key, { discovery, fetchedAt: Date.now() });
  return discovery;
}

async function loadOidcJwks(
  jwksUri: string,
  state: OidcState,
  options: { force?: boolean } = {},
): Promise<JsonWebKeyLike[]> {
  const cached = state.jwksCache.get(jwksUri);
  if (!options.force && cached && Date.now() - cached.fetchedAt < JWKS_TTL_MS) {
    return cached.keys;
  }

  const body = (await fetchJson(jwksUri, state)) as { keys?: JsonWebKeyLike[] };
  const keys = Array.isArray(body.keys) ? body.keys : [];
  if (keys.length === 0) {
    throw new Error("OIDC JWKS document did not include signing keys.");
  }

  state.jwksCache.set(jwksUri, { keys, fetchedAt: Date.now() });
  return keys;
}

function decodeJwtPart<T>(value: string): T | null {
  try {
    return JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as T;
  } catch {
    return null;
  }
}

function publicKeyFromJwk(jwk: JsonWebKeyLike): KeyObject | null {
  if (jwk.kty !== "RSA" || !jwk.n || !jwk.e) {
    return null;
  }

  return createPublicKey({
    format: "jwk",
    key: {
      kty: "RSA",
      n: jwk.n,
      e: jwk.e,
    },
  });
}

function verifyRs256Signature(signingInput: string, signature: string, key: KeyObject): boolean {
  const verifier = createVerify("RSA-SHA256");
  verifier.update(signingInput);
  verifier.end();
  return verifier.verify(key, Buffer.from(signature, "base64url"));
}

function oidcAccessTokenHash(accessToken: string): string {
  const digest = createHash("sha256").update(accessToken).digest();
  return digest.subarray(0, digest.length / 2).toString("base64url");
}

function assertIdTokenClaims(
  payload: JwtPayload,
  options: { issuer: string; clientId: string; nonce: string; accessToken?: string },
): void {
  if (payload.iss !== issuerOrigin(options.issuer)) {
    throw new Error("OIDC ID token issuer mismatch.");
  }

  const audience = payload.aud;
  const audiences = (Array.isArray(audience) ? audience : [audience]).filter(
    (value): value is string => typeof value === "string" && value.length > 0,
  );
  if (!audiences.includes(options.clientId)) {
    throw new Error("OIDC ID token audience mismatch.");
  }

  if (audiences.length > 1 && payload.azp !== options.clientId) {
    throw new Error("OIDC ID token authorized party mismatch.");
  }

  if (payload.azp !== undefined && payload.azp !== options.clientId) {
    throw new Error("OIDC ID token authorized party mismatch.");
  }

  if (typeof payload.at_hash === "string" && !options.accessToken) {
    throw new Error("OIDC ID token access token hash mismatch.");
  }

  if (options.accessToken) {
    const expected = oidcAccessTokenHash(options.accessToken);
    if (
      typeof payload.at_hash !== "string" ||
      !timingSafeCompareString(payload.at_hash, expected)
    ) {
      throw new Error("OIDC ID token access token hash mismatch.");
    }
  }

  if (typeof payload.nonce !== "string" || payload.nonce.length === 0) {
    throw new Error("OIDC ID token nonce mismatch.");
  }

  if (payload.nonce !== options.nonce) {
    throw new Error("OIDC ID token nonce mismatch.");
  }

  if (
    typeof payload.exp !== "number" ||
    !Number.isFinite(payload.exp) ||
    payload.exp * 1000 <= Date.now()
  ) {
    throw new Error("OIDC ID token is expired.");
  }

  if (typeof payload.nbf === "number" && payload.nbf * 1000 > Date.now()) {
    throw new Error("OIDC ID token is not yet valid.");
  }
}

async function verifyOidcIdToken(
  token: string,
  options: OidcVerificationOptions,
  state: OidcState,
): Promise<JwtPayload> {
  const parts = token.split(".");
  if (parts.length !== 3 || !parts[0] || !parts[1] || !parts[2]) {
    throw new Error("OIDC ID token signature is invalid.");
  }

  const header = decodeJwtPart<{ alg?: string; kid?: string; typ?: string }>(parts[0]);
  if (header?.alg !== "RS256") {
    throw new Error("OIDC ID token algorithm must be RS256.");
  }

  let keys = await loadOidcJwks(options.jwksUri, state);
  let candidates = header.kid ? keys.filter((key) => key.kid === header.kid) : keys;
  if (header.kid && candidates.length === 0) {
    keys = await loadOidcJwks(options.jwksUri, state, { force: true });
    candidates = keys.filter((key) => key.kid === header.kid);
  }
  const signingInput = `${parts[0]}.${parts[1]}`;
  let verified = false;
  for (const jwk of candidates) {
    const key = publicKeyFromJwk(jwk);
    if (key && verifyRs256Signature(signingInput, parts[2], key)) {
      verified = true;
      break;
    }
  }

  if (!verified) {
    throw new Error("OIDC ID token signature is invalid.");
  }

  const payload = decodeJwtPart<JwtPayload>(parts[1]);
  if (!payload || payload.sub === undefined || payload.sub === null) {
    throw new Error("OIDC ID token signature is invalid.");
  }

  assertIdTokenClaims(payload, options);
  return payload;
}

export type { OidcClient, OidcDiscovery, OidcNetworkPolicy, OidcVerificationOptions };
export { createOidcClient, oidcAccessTokenHash };
