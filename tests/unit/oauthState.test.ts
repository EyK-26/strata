import { describe, expect, test } from "bun:test";
import {
  clearOAuthStateCookie,
  clearOidcPkceCookie,
  createOAuthState,
  createOAuthStateCookie,
  OIDC_PKCE_COOKIE,
  readOidcPkceCookie,
  sealOidcPkceCookie,
  verifyOAuthState,
} from "@getstrata/core/security/oauthState";

describe("oauth state", () => {
  test("verifies HMAC RelayState without a cookie", () => {
    const { state } = createOAuthState();
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
    const originalSecret = process.env.SESSION_SECRET;
    process.env.APP_ENV = "production";
    process.env.SESSION_SECRET = "oauth-state-unit-test-secret-32ch";
    try {
      expect(createOAuthStateCookie().cookie).toContain("Secure");
      expect(clearOAuthStateCookie()).toContain("Secure");
      expect(sealOidcPkceCookie({ state: "s", nonce: "n", codeVerifier: "v" })).toContain("Secure");
      expect(clearOidcPkceCookie()).toContain("Secure");
    } finally {
      if (originalAppEnv === undefined) {
        delete process.env.APP_ENV;
      } else {
        process.env.APP_ENV = originalAppEnv;
      }
      if (originalSecret === undefined) {
        delete process.env.SESSION_SECRET;
      } else {
        process.env.SESSION_SECRET = originalSecret;
      }
    }
  });

  test("seals PKCE in oidc_pkce bound to the OAuth state", () => {
    const { state } = createOAuthState();
    const cookie = sealOidcPkceCookie({
      state,
      nonce: "nonce-1",
      codeVerifier: "verifier-1",
    });
    expect(cookie.startsWith(`${OIDC_PKCE_COOKIE}=`)).toBe(true);
    expect(cookie).toContain("HttpOnly");
    const pair = cookie.split(";")[0] ?? "";
    const request = new Request("http://example.test/auth/oidc/callback", {
      headers: { cookie: pair },
    });
    expect(readOidcPkceCookie(request, state)).toEqual({
      nonce: "nonce-1",
      codeVerifier: "verifier-1",
    });
    expect(readOidcPkceCookie(request, "other-state")).toBeNull();
    expect(readOidcPkceCookie(request, null)).toBeNull();
    expect(clearOidcPkceCookie()).toContain("Max-Age=0");
  });

  test("rejects a tampered or expired oidc_pkce cookie", () => {
    const { state } = createOAuthState();
    const cookie = sealOidcPkceCookie({
      state,
      nonce: "nonce-1",
      codeVerifier: "verifier-1",
    });
    const pair = cookie.split(";")[0] ?? "";
    const tampered = `${pair}x`;
    const request = new Request("http://example.test/auth/oidc/callback", {
      headers: { cookie: tampered },
    });
    expect(readOidcPkceCookie(request, state)).toBeNull();

    const originalNow = Date.now;
    Date.now = () => originalNow() + 11 * 60 * 1000;
    try {
      const expired = new Request("http://example.test/auth/oidc/callback", {
        headers: { cookie: pair },
      });
      expect(readOidcPkceCookie(expired, state)).toBeNull();
    } finally {
      Date.now = originalNow;
    }
  });
});
