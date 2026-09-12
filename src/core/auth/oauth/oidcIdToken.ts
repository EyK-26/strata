import { createPublicKey, createVerify, type KeyObject } from "node:crypto";
import { isProductionEnv } from "../../runtime/appEnv";
import { safeFetch } from "../../security/safeFetch";
import type { JwtPayload } from "../jwt";

interface OidcDiscovery {
  issuer?: string;
  authorization_endpoint?: string;
  token_endpoint?: string;
  jwks_uri?: string;
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
const discoveryCache = new Map<string, { discovery: OidcDiscovery; fetchedAt: number }>();
const jwksCache = new Map<string, { keys: JsonWebKeyLike[]; fetchedAt: number }>();

function issuerOrigin(issuer: string): string {
  return issuer.replace(/\/$/, "");
}

async function fetchJson(url: string): Promise<unknown> {
  const response = await safeFetch(
    url,
    { headers: { accept: "application/json" } },
    { allowHttp: !isProductionEnv(), timeoutMs: 10_000, maxRedirects: 0 },
  );

  return await response.json();
}

async function loadOidcDiscovery(issuer: string): Promise<OidcDiscovery> {
  const key = issuerOrigin(issuer);
  const cached = discoveryCache.get(key);
  if (cached && Date.now() - cached.fetchedAt < JWKS_TTL_MS) {
    return cached.discovery;
  }

  const discovery = (await fetchJson(`${key}/.well-known/openid-configuration`)) as OidcDiscovery;
  if (
    !discovery?.authorization_endpoint?.trim() ||
    !discovery.jwks_uri?.trim() ||
    !discovery.token_endpoint?.trim()
  ) {
    throw new Error(
      "OIDC discovery document did not include authorization_endpoint, jwks_uri, and token_endpoint.",
    );
  }

  discoveryCache.set(key, { discovery, fetchedAt: Date.now() });
  return discovery;
}

async function loadOidcJwks(
  jwksUri: string,
  options: { force?: boolean } = {},
): Promise<JsonWebKeyLike[]> {
  const cached = jwksCache.get(jwksUri);
  if (!options.force && cached && Date.now() - cached.fetchedAt < JWKS_TTL_MS) {
    return cached.keys;
  }

  const body = (await fetchJson(jwksUri)) as { keys?: JsonWebKeyLike[] };
  const keys = Array.isArray(body.keys) ? body.keys : [];
  if (keys.length === 0) {
    throw new Error("OIDC JWKS document did not include signing keys.");
  }

  jwksCache.set(jwksUri, { keys, fetchedAt: Date.now() });
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

function assertIdTokenClaims(
  payload: JwtPayload,
  options: { issuer: string; clientId: string; nonce: string },
): void {
  if (payload.iss !== issuerOrigin(options.issuer)) {
    throw new Error("OIDC ID token issuer mismatch.");
  }

  const audience = payload.aud;
  const audiences = Array.isArray(audience) ? audience : [audience];
  if (!audiences.includes(options.clientId)) {
    throw new Error("OIDC ID token audience mismatch.");
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
  options: { issuer: string; clientId: string; nonce: string; jwksUri: string },
): Promise<JwtPayload> {
  const parts = token.split(".");
  if (parts.length !== 3 || !parts[0] || !parts[1] || !parts[2]) {
    throw new Error("OIDC ID token signature is invalid.");
  }

  const header = decodeJwtPart<{ alg?: string; kid?: string; typ?: string }>(parts[0]);
  if (header?.alg !== "RS256") {
    throw new Error("OIDC ID token algorithm must be RS256.");
  }

  let keys = await loadOidcJwks(options.jwksUri);
  let candidates = header.kid ? keys.filter((key) => key.kid === header.kid) : keys;
  if (header.kid && candidates.length === 0) {
    keys = await loadOidcJwks(options.jwksUri, { force: true });
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

function resetOidcDiscoveryCacheForTests(): void {
  discoveryCache.clear();
  jwksCache.clear();
}

export type { OidcDiscovery };
export { loadOidcDiscovery, resetOidcDiscoveryCacheForTests, verifyOidcIdToken };
