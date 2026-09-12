import { afterEach, describe, expect, mock, test } from "bun:test";
import { createSign, generateKeyPairSync } from "node:crypto";
import { signJwt } from "@getstrata/core/auth/jwt";
import {
  createOidcHandshake,
  OidcProvider,
  resetOidcDiscoveryCacheForTests,
} from "@getstrata/core/auth/oauth/oidcProvider";
import { resetDnsLookupForTests, setDnsLookupForTests } from "@getstrata/core/security/safeUrl";

const originalFetch = globalThis.fetch;

const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const rsaJwk = publicKey.export({ format: "jwk" });
const JWKS = {
  keys: [{ ...rsaJwk, kid: "test-key", use: "sig", alg: "RS256" }],
};

function mockPublicDns() {
  setDnsLookupForTests(async () => [{ address: "1.1.1.1", family: 4 }]);
}

function signRs256IdToken(payload: Record<string, unknown>, kid = "test-key"): string {
  const now = Math.floor(Date.now() / 1000);
  const body = { iat: now, exp: now + 3600, ...payload };
  const header = Buffer.from(JSON.stringify({ alg: "RS256", typ: "JWT", kid })).toString(
    "base64url",
  );
  const data = Buffer.from(JSON.stringify(body)).toString("base64url");
  const signingInput = `${header}.${data}`;
  const signature = createSign("RSA-SHA256").update(signingInput).sign(privateKey, "base64url");
  return `${signingInput}.${signature}`;
}

function requestPath(input: string | URL | Request): string {
  return new URL(String(input)).pathname;
}

function mockOidcNetwork(idToken?: string, tokenBody?: Record<string, unknown>) {
  globalThis.fetch = mock((input: string | URL | Request) => {
    const path = requestPath(input);
    if (path.includes("openid-configuration")) {
      return Promise.resolve(
        Response.json({
          issuer: "https://issuer.example.com",
          token_endpoint: "https://issuer.example.com/token",
          jwks_uri: "https://issuer.example.com/jwks",
        }),
      );
    }
    if (path === "/jwks") {
      return Promise.resolve(Response.json(JWKS));
    }
    return Promise.resolve(
      Response.json(tokenBody ?? { access_token: "access-token", id_token: idToken }),
    );
  }) as unknown as typeof fetch;
}

afterEach(() => {
  globalThis.fetch = originalFetch;
  resetDnsLookupForTests();
  resetOidcDiscoveryCacheForTests();
});

describe("OidcProvider", () => {
  const options = {
    name: "oidc-test",
    issuer: "https://issuer.example.com/",
    clientId: "client-id",
    clientSecret: "client-secret",
    redirectUri: "https://app.example.com/callback",
  };

  test("refuses getAuthorizationUrl so PKCE cannot be discarded", () => {
    const provider = new OidcProvider(options);
    expect(() => provider.getAuthorizationUrl("state-123")).toThrow("createAuthorization");
  });

  test("builds an authorization url with default scopes", () => {
    const provider = new OidcProvider(options);
    const url = new URL(provider.createAuthorization("state-123").url);

    expect(url.origin).toBe("https://issuer.example.com");
    expect(url.pathname).toBe("/authorize");
    expect(url.searchParams.get("client_id")).toBe("client-id");
    expect(url.searchParams.get("scope")).toBe("openid email profile");
    expect(url.searchParams.get("state")).toBe("state-123");
    expect(url.searchParams.get("nonce")).toBeTruthy();
    expect(url.searchParams.get("code_challenge")).toBeTruthy();
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("redirect_uri")).toBe(options.redirectUri);

    const webUrl = new URL(
      provider.createAuthorization("state-123", "https://app.example.com/oauth/oidc/callback").url,
    );
    expect(webUrl.searchParams.get("redirect_uri")).toBe(
      "https://app.example.com/oauth/oidc/callback",
    );
  });

  test("builds an authorization url with custom scopes", () => {
    const provider = new OidcProvider({
      ...options,
      scopes: ["openid", "groups"],
    });

    const url = new URL(provider.createAuthorization("state-456").url);

    expect(url.searchParams.get("scope")).toBe("openid groups");
  });

  test("createAuthorization returns a handshake with PKCE and nonce", () => {
    const provider = new OidcProvider(options);
    const { url, handshake } = provider.createAuthorization("fixed-state");
    const parsed = new URL(url);
    expect(handshake.state).toBe("fixed-state");
    expect(handshake.nonce).toHaveLength(48);
    expect(handshake.codeVerifier.length).toBeGreaterThan(20);
    expect(parsed.searchParams.get("nonce")).toBe(handshake.nonce);
    expect(createOidcHandshake().codeVerifier).not.toBe(handshake.codeVerifier);
  });

  test("exchanges a code using an override redirect uri", async () => {
    mockPublicDns();
    let tokenBody = "";
    const handshake = createOidcHandshake();
    const idToken = signRs256IdToken({
      sub: "user-web",
      iss: "https://issuer.example.com",
      aud: ["client-id", "other"],
      nonce: handshake.nonce,
      email: "web@example.com",
      name: "Web OIDC",
    });

    globalThis.fetch = mock((input: string | URL | Request, init?: RequestInit) => {
      const path = requestPath(input);
      if (path.includes("openid-configuration")) {
        return Promise.resolve(
          Response.json({
            issuer: "https://issuer.example.com",
            token_endpoint: "https://issuer.example.com/token",
            jwks_uri: "https://issuer.example.com/jwks",
          }),
        );
      }
      if (path === "/jwks") {
        return Promise.resolve(Response.json(JWKS));
      }
      tokenBody = String(init?.body ?? "");
      return Promise.resolve(Response.json({ access_token: "access-token", id_token: idToken }));
    }) as unknown as typeof fetch;

    const provider = new OidcProvider(options);
    await provider.exchangeCode(
      "auth-code",
      "https://app.example.com/oauth/oidc/callback",
      handshake,
    );

    expect(tokenBody).toContain(encodeURIComponent("https://app.example.com/oauth/oidc/callback"));
    expect(tokenBody).toContain("code_verifier");
  });

  test("exchanges a code for a profile from a signed ID token", async () => {
    mockPublicDns();
    const handshake = createOidcHandshake();
    const idToken = signRs256IdToken({
      sub: "user-1",
      iss: "https://issuer.example.com",
      aud: "client-id",
      nonce: handshake.nonce,
      email: "user@example.com",
      name: "OIDC User",
    });
    mockOidcNetwork(idToken);

    const provider = new OidcProvider(options);
    const profile = await provider.exchangeCode("auth-code", options.redirectUri, handshake);

    expect(profile).toEqual({
      providerUserId: "user-1",
      email: "user@example.com",
      name: "OIDC User",
    });
  });

  test("falls back to sub when the ID token omits name", async () => {
    mockPublicDns();
    const handshake = createOidcHandshake();
    const idToken = signRs256IdToken({
      sub: "user-3",
      iss: "https://issuer.example.com",
      aud: "client-id",
      nonce: handshake.nonce,
      email: "noname@example.com",
    });
    mockOidcNetwork(idToken);

    const provider = new OidcProvider(options);
    await expect(
      provider.exchangeCode("auth-code", options.redirectUri, handshake),
    ).resolves.toEqual({
      providerUserId: "user-3",
      email: "noname@example.com",
      name: "user-3",
    });
  });

  test("rejects an ID token without an email address", async () => {
    mockPublicDns();
    const handshake = createOidcHandshake();
    const idToken = signRs256IdToken({
      sub: "user-2",
      iss: "https://issuer.example.com",
      aud: "client-id",
      nonce: handshake.nonce,
    });
    mockOidcNetwork(idToken);
    const provider = new OidcProvider(options);
    await expect(
      provider.exchangeCode("auth-code", options.redirectUri, handshake),
    ).rejects.toThrow("did not include an email address");
  });

  test("rejects an unsigned userinfo-only token response", async () => {
    mockPublicDns();
    mockOidcNetwork(undefined, { access_token: "access-token" });

    const provider = new OidcProvider(options);
    await expect(provider.exchangeCode("auth-code")).rejects.toThrow("PKCE handshake");
  });

  test("validates a signed ID token when a handshake is present", async () => {
    mockPublicDns();
    const handshake = createOidcHandshake();
    const idToken = signRs256IdToken({
      sub: "user-jwt",
      iss: "https://issuer.example.com",
      aud: "client-id",
      nonce: handshake.nonce,
      email: "jwt@example.com",
      name: "JWT User",
    });
    mockOidcNetwork(idToken);

    const provider = new OidcProvider(options);
    await expect(
      provider.exchangeCode("auth-code", options.redirectUri, handshake),
    ).resolves.toEqual({
      providerUserId: "user-jwt",
      email: "jwt@example.com",
      name: "JWT User",
    });
  });

  test("rejects a handshake that omits the ID token", async () => {
    mockPublicDns();
    const handshake = createOidcHandshake();
    mockOidcNetwork(undefined, { access_token: "access-token" });

    const provider = new OidcProvider(options);
    await expect(
      provider.exchangeCode("auth-code", options.redirectUri, handshake),
    ).rejects.toThrow("did not return an ID token");
  });

  test("rejects a handshake without a verifiable ID token", async () => {
    mockPublicDns();
    const handshake = createOidcHandshake();
    mockOidcNetwork("not-a-jwt");

    const provider = new OidcProvider(options);
    await expect(
      provider.exchangeCode("auth-code", options.redirectUri, handshake),
    ).rejects.toThrow("OIDC ID token signature is invalid");
  });

  test("rejects HS256 ID tokens", async () => {
    mockPublicDns();
    const handshake = createOidcHandshake();
    const idToken = signJwt(
      {
        sub: "user-jwt",
        iss: "https://issuer.example.com",
        aud: "client-id",
        nonce: handshake.nonce,
        email: "jwt@example.com",
      },
      { secret: "client-secret" },
    );
    mockOidcNetwork(idToken);
    const provider = new OidcProvider(options);
    await expect(
      provider.exchangeCode("auth-code", options.redirectUri, handshake),
    ).rejects.toThrow("OIDC ID token algorithm must be RS256");
  });

  test("rejects claim mismatches on a signed ID token", async () => {
    mockPublicDns();
    const handshake = createOidcHandshake();
    const provider = new OidcProvider(options);
    const cases = [
      {
        claims: {
          sub: "user-jwt",
          iss: "https://other-issuer.example.com",
          aud: "client-id",
          nonce: handshake.nonce,
          email: "jwt@example.com",
        },
        error: "issuer mismatch",
      },
      {
        claims: {
          sub: "user-jwt",
          iss: "https://issuer.example.com",
          aud: "other-client",
          nonce: handshake.nonce,
          email: "jwt@example.com",
        },
        error: "audience mismatch",
      },
      {
        claims: {
          sub: "user-jwt",
          iss: "https://issuer.example.com",
          aud: "client-id",
          nonce: "wrong-nonce",
          email: "jwt@example.com",
        },
        error: "nonce mismatch",
      },
    ] as const;

    for (const item of cases) {
      mockOidcNetwork(signRs256IdToken(item.claims));
      await expect(
        provider.exchangeCode("auth-code", options.redirectUri, handshake),
      ).rejects.toThrow(item.error);
    }
  });

  test("rejects a nonce-less ID token when a handshake is present", async () => {
    mockPublicDns();
    const handshake = createOidcHandshake();
    const noNonce = signRs256IdToken({
      sub: "user-jwt",
      iss: "https://issuer.example.com",
      aud: "client-id",
      email: "jwt@example.com",
    });
    mockOidcNetwork(noNonce);
    const provider = new OidcProvider(options);
    await expect(
      provider.exchangeCode("auth-code", options.redirectUri, handshake),
    ).rejects.toThrow("nonce mismatch");
  });

  test("rejects a nonce-less ID token", async () => {
    mockPublicDns();
    const noNonce = signRs256IdToken({
      sub: "user-jwt",
      iss: "https://issuer.example.com",
      aud: "client-id",
    });
    mockOidcNetwork(noNonce);
    const provider = new OidcProvider(options);
    await expect(provider.exchangeCode("auth-code")).rejects.toThrow("PKCE handshake");
  });

  test("throws when token exchange does not return an access token", async () => {
    mockPublicDns();
    mockOidcNetwork(undefined, { error: "invalid_grant" });

    const provider = new OidcProvider(options);

    await expect(provider.exchangeCode("bad-code")).rejects.toThrow("PKCE handshake");
  });
});
