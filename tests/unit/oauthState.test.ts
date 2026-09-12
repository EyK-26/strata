import { describe, expect, test } from "bun:test";
import {
  clearOAuthStateCookie,
  createOAuthStateCookie,
  verifyOAuthState,
} from "@getstrata/core/security/oauthState";

describe("oauth state", () => {
  test("verifies HMAC RelayState without a cookie", () => {
    const { state } = createOAuthStateCookie();
    const request = new Request("http://example.test/auth/saml/acs");

    expect(verifyOAuthState(request, state)).toBe(true);
    expect(verifyOAuthState(request, "wrong-state")).toBe(false);
  });

  test("rejects missing, empty, malformed, and expired oauth state", () => {
    const { state } = createOAuthStateCookie();
    const request = new Request("http://example.test/auth/callback");

    expect(verifyOAuthState(request, null)).toBe(false);
    expect(verifyOAuthState(request, "   ")).toBe(false);
    expect(verifyOAuthState(request, "abc.def.ghi")).toBe(false);
    expect(verifyOAuthState(request, "abc.notanumber.ffff")).toBe(false);
    expect(clearOAuthStateCookie()).toContain("Max-Age=0");

    const [nonce, issuedAtRaw, signature] = state.split(".");
    expect(verifyOAuthState(request, `.${issuedAtRaw}.${signature}`)).toBe(false);
    expect(verifyOAuthState(request, `${nonce}.${issuedAtRaw}`)).toBe(false);
    expect(verifyOAuthState(request, `${nonce}.${issuedAtRaw}.${signature}x`)).toBe(false);

    const originalNow = Date.now;
    Date.now = () => originalNow() + 11 * 60 * 1000;
    try {
      expect(verifyOAuthState(request, state)).toBe(false);
    } finally {
      Date.now = originalNow;
    }
  });

  test("marks oauth state cookies Secure in production", () => {
    const originalAppEnv = process.env.APP_ENV;
    process.env.APP_ENV = "production";
    try {
      expect(createOAuthStateCookie().cookie).toContain("Secure");
      expect(clearOAuthStateCookie()).toContain("Secure");
    } finally {
      if (originalAppEnv === undefined) {
        delete process.env.APP_ENV;
      } else {
        process.env.APP_ENV = originalAppEnv;
      }
    }
  });
});
