import { afterEach, describe, expect, mock, test } from "bun:test";
import { GitHubOAuthProvider, MockOAuthProvider } from "@getstrata/core/auth/oauth/providers";
import { restoreEnvVar } from "../helpers/restoreEnv";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("GitHubOAuthProvider", () => {
  const options = {
    clientId: "github-client",
    clientSecret: "github-secret",
    redirectUri: "https://app.example.com/auth/github/callback",
  };

  test("builds a GitHub authorization url", () => {
    const provider = new GitHubOAuthProvider(options);
    const url = new URL(provider.getAuthorizationUrl("gh-state"));

    expect(url.hostname).toBe("github.com");
    expect(url.pathname).toBe("/login/oauth/authorize");
    expect(url.searchParams.get("client_id")).toBe("github-client");
    expect(url.searchParams.get("state")).toBe("gh-state");
    expect(url.searchParams.get("redirect_uri")).toBe(options.redirectUri);

    const webUrl = new URL(
      provider.getAuthorizationUrl("gh-state", "https://app.example.com/oauth/github/callback"),
    );
    expect(webUrl.searchParams.get("redirect_uri")).toBe(
      "https://app.example.com/oauth/github/callback",
    );
  });

  test("exchanges a code using an override redirect uri", async () => {
    let tokenBody = "";

    globalThis.fetch = mock((input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);

      if (url.includes("/login/oauth/access_token")) {
        tokenBody = String(init?.body ?? "");
        return Promise.resolve(Response.json({ access_token: "gh-token" }));
      }

      return Promise.resolve(
        Response.json({
          id: 7,
          login: "web-octocat",
          email: "web@github.com",
          name: "Web Octocat",
        }),
      );
    }) as unknown as typeof fetch;

    const provider = new GitHubOAuthProvider(options);
    await provider.exchangeCode("gh-code", "https://app.example.com/oauth/github/callback");

    expect(tokenBody).toContain("https://app.example.com/oauth/github/callback");
  });

  test("exchanges a code for a profile", async () => {
    const previousUserAgent = process.env.APP_USER_AGENT;
    const previousPrefix = process.env.APP_KEY_PREFIX;
    delete process.env.APP_USER_AGENT;
    delete process.env.APP_KEY_PREFIX;
    let profileUserAgent = "";

    globalThis.fetch = mock((input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);

      if (url.includes("/login/oauth/access_token")) {
        return Promise.resolve(Response.json({ access_token: "gh-token" }));
      }

      profileUserAgent = new Headers(init?.headers).get("user-agent") ?? "";

      return Promise.resolve(
        Response.json({
          id: 42,
          login: "octocat",
          email: "octocat@github.com",
          name: "The Octocat",
        }),
      );
    }) as unknown as typeof fetch;

    try {
      const provider = new GitHubOAuthProvider(options);
      const profile = await provider.exchangeCode("gh-code");

      expect(profile).toEqual({
        providerUserId: "42",
        email: "octocat@github.com",
        name: "The Octocat",
      });
      expect(profileUserAgent).toBe("workhub");
    } finally {
      restoreEnvVar("APP_USER_AGENT", previousUserAgent);
      restoreEnvVar("APP_KEY_PREFIX", previousPrefix);
    }
  });

  test("falls back when GitHub profile fields are missing", async () => {
    globalThis.fetch = mock((input: string | URL | Request) => {
      const url = String(input);

      if (url.includes("/login/oauth/access_token")) {
        return Promise.resolve(Response.json({ access_token: "gh-token" }));
      }

      return Promise.resolve(
        Response.json({
          id: 99,
          login: "ghost",
          email: null,
          name: null,
        }),
      );
    }) as unknown as typeof fetch;

    const provider = new GitHubOAuthProvider(options);
    const profile = await provider.exchangeCode("gh-code");

    expect(profile).toEqual({
      providerUserId: "99",
      email: "ghost@users.noreply.github.com",
      name: "ghost",
    });
  });

  test("throws when token exchange fails", async () => {
    globalThis.fetch = mock(() =>
      Promise.resolve(Response.json({ error: "bad_verification_code" })),
    ) as unknown as typeof fetch;

    const provider = new GitHubOAuthProvider(options);

    await expect(provider.exchangeCode("bad-code")).rejects.toThrow(
      "GitHub OAuth token exchange failed.",
    );
  });
});

describe("MockOAuthProvider", () => {
  test("returns the configured profile for a valid code", async () => {
    const provider = new MockOAuthProvider({
      providerUserId: "mock-user",
      email: "mock@example.com",
      name: "Mock User",
    });

    expect(provider.getAuthorizationUrl("mock-state")).toContain("state=mock-state");

    await expect(provider.exchangeCode("valid-code")).resolves.toEqual({
      providerUserId: "mock-user",
      email: "mock@example.com",
      name: "Mock User",
    });
  });

  test("rejects invalid oauth codes", async () => {
    const provider = new MockOAuthProvider({
      providerUserId: "mock-user",
      email: "mock@example.com",
      name: "Mock User",
    });

    await expect(provider.exchangeCode("invalid")).rejects.toThrow("Invalid OAuth code.");
  });
});
