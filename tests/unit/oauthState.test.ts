import { describe, expect, test } from "bun:test";
import { createOAuthStateCookie, verifyOAuthState } from "../../src/core/security/oauthState";

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
});
