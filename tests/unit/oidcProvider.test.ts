import { afterEach, describe, expect, mock, test } from "bun:test";
import { OidcProvider } from "@getstrata/core/auth/oauth/oidcProvider";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("OidcProvider", () => {
  const options = {
    name: "oidc-test",
    issuer: "https://issuer.example.com/",
    clientId: "client-id",
    clientSecret: "client-secret",
    redirectUri: "https://app.example.com/callback",
  };

  test("builds an authorization url with default scopes", () => {
    const provider = new OidcProvider(options);
    const url = new URL(provider.getAuthorizationUrl("state-123"));

    expect(url.origin).toBe("https://issuer.example.com");
    expect(url.pathname).toBe("/authorize");
    expect(url.searchParams.get("client_id")).toBe("client-id");
    expect(url.searchParams.get("scope")).toBe("openid email profile");
    expect(url.searchParams.get("state")).toBe("state-123");
    expect(url.searchParams.get("redirect_uri")).toBe(options.redirectUri);

    const webUrl = new URL(
      provider.getAuthorizationUrl("state-123", "https://app.example.com/oauth/oidc/callback"),
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

    const url = new URL(provider.getAuthorizationUrl("state-456"));

    expect(url.searchParams.get("scope")).toBe("openid groups");
  });

  test("exchanges a code using an override redirect uri", async () => {
    let tokenBody = "";

    globalThis.fetch = mock((input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);

      if (url.endsWith("/token")) {
        tokenBody = String(init?.body ?? "");
        return Promise.resolve(Response.json({ access_token: "access-token" }));
      }

      return Promise.resolve(
        Response.json({
          sub: "user-web",
          email: "web@example.com",
          name: "Web OIDC",
        }),
      );
    }) as unknown as typeof fetch;

    const provider = new OidcProvider(options);
    await provider.exchangeCode("auth-code", "https://app.example.com/oauth/oidc/callback");

    expect(tokenBody).toContain(encodeURIComponent("https://app.example.com/oauth/oidc/callback"));
  });

  test("exchanges a code for a profile", async () => {
    globalThis.fetch = mock((input: string | URL | Request) => {
      const url = String(input);

      if (url.endsWith("/token")) {
        return Promise.resolve(
          Response.json({
            access_token: "access-token",
          }),
        );
      }

      return Promise.resolve(
        Response.json({
          sub: "user-1",
          email: "user@example.com",
          name: "OIDC User",
        }),
      );
    }) as unknown as typeof fetch;

    const provider = new OidcProvider(options);
    const profile = await provider.exchangeCode("auth-code");

    expect(profile).toEqual({
      providerUserId: "user-1",
      email: "user@example.com",
      name: "OIDC User",
    });
  });

  test("falls back when email and name are missing", async () => {
    globalThis.fetch = mock((input: string | URL | Request) => {
      const url = String(input);

      if (url.endsWith("/token")) {
        return Promise.resolve(Response.json({ access_token: "access-token" }));
      }

      return Promise.resolve(Response.json({ sub: "user-2" }));
    }) as unknown as typeof fetch;

    const provider = new OidcProvider(options);
    const profile = await provider.exchangeCode("auth-code");

    expect(profile).toEqual({
      providerUserId: "user-2",
      email: "user-2@oidc.local",
      name: "user-2",
    });
  });

  test("throws when token exchange does not return an access token", async () => {
    globalThis.fetch = mock(() =>
      Promise.resolve(Response.json({ error: "invalid_grant" })),
    ) as unknown as typeof fetch;

    const provider = new OidcProvider(options);

    await expect(provider.exchangeCode("bad-code")).rejects.toThrow("OIDC token exchange failed.");
  });
});
