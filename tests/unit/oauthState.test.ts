import { describe, expect, test } from "bun:test";
import {
  clearOAuthStateCookie,
  createOAuthStateCookie,
  verifyOAuthState,
} from "@getstrata/core/security/oauthState";

describe("oauth state", () => {
  test("creates and verifies a signed oauth state cookie", () => {
    const { state, cookie } = createOAuthStateCookie();
    const request = new Request("http://example.test/auth/callback", {
      headers: {
        cookie,
      },
    });

    expect(verifyOAuthState(request, state)).toBe(true);
    expect(verifyOAuthState(request, "wrong-state")).toBe(false);
  });

  test("rejects missing, empty, malformed, and expired oauth state", () => {
    const { state, cookie } = createOAuthStateCookie();
    const validRequest = new Request("http://example.test/auth/callback", {
      headers: { cookie },
    });

    expect(verifyOAuthState(validRequest, null)).toBe(false);
    expect(verifyOAuthState(validRequest, "   ")).toBe(false);
    expect(verifyOAuthState(new Request("http://example.test/auth/callback"), state)).toBe(false);
    expect(
      verifyOAuthState(
        new Request("http://example.test/auth/callback", {
          headers: { cookie: "oauth_state=abc.def.ghi" },
        }),
        "abc",
      ),
    ).toBe(false);
    expect(clearOAuthStateCookie()).toContain("Max-Age=0");
  });

  test("rejects oauth state cookies with invalid part counts and mismatched signatures", () => {
    const { state, cookie } = createOAuthStateCookie();
    const validRequest = new Request("http://example.test/auth/callback", {
      headers: { cookie },
    });
    const [cookiePair] = cookie.split(";");
    const encodedValue = decodeURIComponent(cookiePair?.split("=")[1] ?? "");
    const [cookieState, issuedAtRaw, signature] = encodedValue.split(".");

    expect(
      verifyOAuthState(
        new Request("http://example.test/auth/callback", {
          headers: { cookie: "other=1" },
        }),
        state,
      ),
    ).toBe(false);

    expect(
      verifyOAuthState(
        new Request("http://example.test/auth/callback", {
          headers: { cookie: `oauth_state=${encodeURIComponent(`.${issuedAtRaw}.${signature}`)}` },
        }),
        state,
      ),
    ).toBe(false);

    expect(
      verifyOAuthState(
        new Request("http://example.test/auth/callback", {
          headers: { cookie: `oauth_state=${encodeURIComponent(`${cookieState}.${issuedAtRaw}`)}` },
        }),
        state,
      ),
    ).toBe(false);

    expect(
      verifyOAuthState(
        new Request("http://example.test/auth/callback", {
          headers: {
            cookie: `oauth_state=${encodeURIComponent(`${cookieState}.${issuedAtRaw}.${signature}x`)}`,
          },
        }),
        state,
      ),
    ).toBe(false);

    expect(
      verifyOAuthState(
        new Request("http://example.test/auth/callback", {
          headers: { cookie: `other=1; ${cookiePair}` },
        }),
        state,
      ),
    ).toBe(true);

    const originalNow = Date.now;
    Date.now = () => originalNow() + 11 * 60 * 1000;
    try {
      expect(verifyOAuthState(validRequest, state)).toBe(false);
    } finally {
      Date.now = originalNow;
    }
  });
});
