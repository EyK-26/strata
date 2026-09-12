import { afterEach, describe, expect, mock, test } from "bun:test";
import { createSign, generateKeyPairSync } from "node:crypto";
import {
  loadOidcDiscovery,
  resetOidcDiscoveryCacheForTests,
  verifyOidcIdToken,
} from "@getstrata/core/auth/oauth/oidcIdToken";
import { resetDnsLookupForTests, setDnsLookupForTests } from "@getstrata/core/security/safeUrl";

const originalFetch = globalThis.fetch;
const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const rsaJwk = publicKey.export({ format: "jwk" });

function mockPublicDns() {
  setDnsLookupForTests(async () => [{ address: "1.1.1.1", family: 4 }]);
}

function signRs256IdToken(
  payload: Record<string, unknown>,
  kid: string | undefined = "test-key",
): string {
  const now = Math.floor(Date.now() / 1000);
  const body = { iat: now, exp: now + 3600, ...payload };
  const header = Buffer.from(
    JSON.stringify({ alg: "RS256", typ: "JWT", ...(kid ? { kid } : {}) }),
  ).toString("base64url");
  const data = Buffer.from(JSON.stringify(body)).toString("base64url");
  const signingInput = `${header}.${data}`;
  const signature = createSign("RSA-SHA256").update(signingInput).sign(privateKey, "base64url");
  return `${signingInput}.${signature}`;
}

function requestPath(input: string | URL | Request): string {
  return new URL(String(input)).pathname;
}

function mockOidcDocuments(jwks: unknown, discovery: Record<string, unknown> = {}) {
  globalThis.fetch = mock((input: string | URL | Request) => {
    const path = requestPath(input);
    if (path.includes("openid-configuration")) {
      return Promise.resolve(
        Response.json({
          issuer: "https://issuer.example.com",
          authorization_endpoint: "https://issuer.example.com/oauth/v2/authorize",
          token_endpoint: "https://issuer.example.com/token",
          jwks_uri: "https://issuer.example.com/jwks",
          ...discovery,
        }),
      );
    }
    return Promise.resolve(Response.json(jwks));
  }) as unknown as typeof fetch;
}

afterEach(() => {
  globalThis.fetch = originalFetch;
  resetDnsLookupForTests();
  resetOidcDiscoveryCacheForTests();
});

describe("oidcIdToken", () => {
  const options = {
    issuer: "https://issuer.example.com/",
    clientId: "client-id",
    nonce: "nonce-1",
    jwksUri: "https://issuer.example.com/jwks",
  };

  test("rejects discovery documents that omit required endpoints", async () => {
    mockPublicDns();
    mockOidcDocuments(
      { keys: [] },
      { jwks_uri: "", token_endpoint: "", authorization_endpoint: "" },
    );
    await expect(loadOidcDiscovery("https://issuer.example.com")).rejects.toThrow(
      "authorization_endpoint, jwks_uri, and token_endpoint",
    );
  });

  test("reuses discovery and JWKS within the cache TTL", async () => {
    mockPublicDns();
    let discoveryCalls = 0;
    let jwksCalls = 0;
    const token = signRs256IdToken({
      sub: "user-1",
      iss: "https://issuer.example.com",
      aud: "client-id",
      nonce: "nonce-1",
    });
    globalThis.fetch = mock((input: string | URL | Request) => {
      const path = requestPath(input);
      if (path.includes("openid-configuration")) {
        discoveryCalls += 1;
        return Promise.resolve(
          Response.json({
            issuer: "https://issuer.example.com",
            authorization_endpoint: "https://issuer.example.com/oauth/v2/authorize",
            token_endpoint: "https://issuer.example.com/token",
            jwks_uri: "https://issuer.example.com/jwks",
          }),
        );
      }
      jwksCalls += 1;
      return Promise.resolve(
        Response.json({ keys: [{ ...rsaJwk, kid: "test-key", alg: "RS256" }] }),
      );
    }) as unknown as typeof fetch;

    await loadOidcDiscovery("https://issuer.example.com");
    await loadOidcDiscovery("https://issuer.example.com/");
    await verifyOidcIdToken(token, options);
    await verifyOidcIdToken(token, options);
    expect(discoveryCalls).toBe(1);
    expect(jwksCalls).toBe(1);
  });

  test("rejects an empty JWKS document", async () => {
    mockPublicDns();
    mockOidcDocuments({ keys: [] });
    const token = signRs256IdToken({
      sub: "user-1",
      iss: "https://issuer.example.com",
      aud: "client-id",
      nonce: "nonce-1",
    });
    await expect(verifyOidcIdToken(token, options)).rejects.toThrow("signing keys");
  });

  test("rejects a JWKS body that is not a key list", async () => {
    mockPublicDns();
    mockOidcDocuments({ keys: "nope" });
    const token = signRs256IdToken({
      sub: "user-1",
      iss: "https://issuer.example.com",
      aud: "client-id",
      nonce: "nonce-1",
    });
    await expect(verifyOidcIdToken(token, options)).rejects.toThrow("signing keys");
  });

  test("rejects malformed JWT JSON parts", async () => {
    mockPublicDns();
    mockOidcDocuments({ keys: [{ ...rsaJwk, kid: "test-key" }] });
    const junk = Buffer.from("not-json").toString("base64url");
    await expect(verifyOidcIdToken(`${junk}.${junk}.sig`, options)).rejects.toThrow(
      "OIDC ID token algorithm must be RS256",
    );
  });

  test("skips non-RSA JWKs and invalid RSA material", async () => {
    mockPublicDns();
    mockOidcDocuments({
      keys: [
        { kty: "EC", kid: "test-key", n: "n", e: "e" },
        { kty: "RSA", kid: "test-key", n: "%%%", e: "AQAB" },
      ],
    });
    const token = signRs256IdToken({
      sub: "user-1",
      iss: "https://issuer.example.com",
      aud: "client-id",
      nonce: "nonce-1",
    });
    await expect(verifyOidcIdToken(token, options)).rejects.toThrow("signature is invalid");
  });

  test("rejects a token whose signature does not match the JWKS key", async () => {
    mockPublicDns();
    mockOidcDocuments({ keys: [{ ...rsaJwk, kid: "test-key" }] });
    const token = signRs256IdToken({
      sub: "user-1",
      iss: "https://issuer.example.com",
      aud: "client-id",
      nonce: "nonce-1",
    });
    const tampered = `${token.slice(0, -2)}aa`;
    await expect(verifyOidcIdToken(tampered, options)).rejects.toThrow("signature is invalid");
  });

  test("rejects expired and not-yet-valid ID tokens", async () => {
    mockPublicDns();
    mockOidcDocuments({ keys: [{ ...rsaJwk, kid: "test-key" }] });
    const expired = signRs256IdToken({
      sub: "user-1",
      iss: "https://issuer.example.com",
      aud: "client-id",
      nonce: "nonce-1",
      exp: Math.floor(Date.now() / 1000) - 30,
    });
    await expect(verifyOidcIdToken(expired, options)).rejects.toThrow("is expired");

    const notYet = signRs256IdToken({
      sub: "user-1",
      iss: "https://issuer.example.com",
      aud: "client-id",
      nonce: "nonce-1",
      nbf: Math.floor(Date.now() / 1000) + 3600,
    });
    await expect(verifyOidcIdToken(notYet, options)).rejects.toThrow("not yet valid");
  });

  test("rejects a signed token without a subject", async () => {
    mockPublicDns();
    mockOidcDocuments({ keys: [{ ...rsaJwk, kid: "test-key" }] });
    const token = signRs256IdToken({
      iss: "https://issuer.example.com",
      aud: "client-id",
      nonce: "nonce-1",
    });
    await expect(verifyOidcIdToken(token, options)).rejects.toThrow("signature is invalid");
  });

  test("verifies a token against every key when kid is omitted", async () => {
    mockPublicDns();
    mockOidcDocuments({
      keys: [
        { kty: "EC", kid: "ec-key" },
        { ...rsaJwk, kid: "other-key" },
      ],
    });
    const token = signRs256IdToken(
      {
        sub: "user-1",
        iss: "https://issuer.example.com",
        aud: "client-id",
        nonce: "nonce-1",
      },
      "",
    );
    await expect(verifyOidcIdToken(token, options)).resolves.toMatchObject({ sub: "user-1" });
  });

  test("refetches JWKS when the token kid is missing from the cache", async () => {
    mockPublicDns();
    let jwksCalls = 0;
    const token = signRs256IdToken({
      sub: "user-1",
      iss: "https://issuer.example.com",
      aud: "client-id",
      nonce: "nonce-1",
    });
    globalThis.fetch = mock((input: string | URL | Request) => {
      const path = requestPath(input);
      if (path.includes("openid-configuration")) {
        return Promise.resolve(
          Response.json({
            issuer: "https://issuer.example.com",
            authorization_endpoint: "https://issuer.example.com/oauth/v2/authorize",
            token_endpoint: "https://issuer.example.com/token",
            jwks_uri: "https://issuer.example.com/jwks",
          }),
        );
      }
      jwksCalls += 1;
      if (jwksCalls === 1) {
        return Promise.resolve(
          Response.json({ keys: [{ ...rsaJwk, kid: "old-key", alg: "RS256" }] }),
        );
      }
      return Promise.resolve(
        Response.json({ keys: [{ ...rsaJwk, kid: "test-key", alg: "RS256" }] }),
      );
    }) as unknown as typeof fetch;

    await expect(verifyOidcIdToken(token, options)).resolves.toMatchObject({ sub: "user-1" });
    expect(jwksCalls).toBe(2);
  });
});
