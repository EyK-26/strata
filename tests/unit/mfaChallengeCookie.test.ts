import { afterEach, describe, expect, test } from "bun:test";
import {
  clearMfaChallengeCookie,
  createMfaChallengeCookie,
  DEFAULT_MFA_CHALLENGE_TTL_SECONDS,
  MFA_CHALLENGE_COOKIE,
  mfaChallengeCookieName,
  mfaChallengeTtlSeconds,
  readMfaChallenge,
} from "../../src/modules/user/mfaChallengeCookie";

describe("mfaChallengeCookie", () => {
  const originalAppEnv = process.env.APP_ENV;
  const originalSessionSecret = process.env.SESSION_SECRET;
  const originalOAuthStateSecret = process.env.OAUTH_STATE_SECRET;
  const originalCookieName = process.env.MFA_CHALLENGE_COOKIE_NAME;
  const originalTtl = process.env.MFA_CHALLENGE_TTL_SECONDS;

  afterEach(() => {
    if (originalAppEnv === undefined) {
      delete process.env.APP_ENV;
    } else {
      process.env.APP_ENV = originalAppEnv;
    }

    if (originalSessionSecret === undefined) {
      delete process.env.SESSION_SECRET;
    } else {
      process.env.SESSION_SECRET = originalSessionSecret;
    }

    if (originalOAuthStateSecret === undefined) {
      delete process.env.OAUTH_STATE_SECRET;
    } else {
      process.env.OAUTH_STATE_SECRET = originalOAuthStateSecret;
    }

    if (originalCookieName === undefined) {
      delete process.env.MFA_CHALLENGE_COOKIE_NAME;
    } else {
      process.env.MFA_CHALLENGE_COOKIE_NAME = originalCookieName;
    }

    if (originalTtl === undefined) {
      delete process.env.MFA_CHALLENGE_TTL_SECONDS;
    } else {
      process.env.MFA_CHALLENGE_TTL_SECONDS = originalTtl;
    }
  });

  test("creates and reads a signed challenge cookie", () => {
    const cookiePair = createMfaChallengeCookie(42, { remember: true }).split(";")[0] ?? "";
    const request = new Request("http://example.test/two-factor-challenge", {
      headers: { cookie: cookiePair },
    });

    expect(readMfaChallenge(request)).toEqual({ userId: 42, remember: true });
    expect(readMfaChallenge(new Request("http://example.test/two-factor-challenge"))).toBeNull();
  });

  test("rejects missing, malformed, expired, and tampered cookies", () => {
    expect(
      readMfaChallenge(
        new Request("http://example.test/two-factor-challenge", {
          headers: { cookie: "workhub_session=1.2.0.deadbeef" },
        }),
      ),
    ).toBeNull();

    expect(
      readMfaChallenge(
        new Request("http://example.test/two-factor-challenge", {
          headers: { cookie: "workhub_mfa_pending=1.2.0" },
        }),
      ),
    ).toBeNull();

    expect(
      readMfaChallenge(
        new Request("http://example.test/two-factor-challenge", {
          headers: { cookie: "workhub_mfa_pending=0.123.0.deadbeef" },
        }),
      ),
    ).toBeNull();

    expect(
      readMfaChallenge(
        new Request("http://example.test/two-factor-challenge", {
          headers: { cookie: "workhub_mfa_pending=1.abc.0.deadbeef" },
        }),
      ),
    ).toBeNull();

    expect(
      readMfaChallenge(
        new Request("http://example.test/two-factor-challenge", {
          headers: { cookie: "workhub_mfa_pending=1.123.yes.deadbeef" },
        }),
      ),
    ).toBeNull();

    const expiredIssuedAt = Date.now() - DEFAULT_MFA_CHALLENGE_TTL_SECONDS * 1000 - 1_000;
    expect(
      readMfaChallenge(
        new Request("http://example.test/two-factor-challenge", {
          headers: {
            cookie: `workhub_mfa_pending=${encodeURIComponent(`${42}.${expiredIssuedAt}.0.deadbeef`)}`,
          },
        }),
      ),
    ).toBeNull();

    const freshIssuedAt = Date.now();
    expect(
      readMfaChallenge(
        new Request("http://example.test/two-factor-challenge", {
          headers: { cookie: `workhub_mfa_pending=1.${freshIssuedAt}.0.` },
        }),
      ),
    ).toBeNull();

    const validCookie = createMfaChallengeCookie(42).split(";")[0]?.split("=")[1] ?? "";
    const decoded = decodeURIComponent(validCookie);
    const [userIdRaw, issuedAtRaw, rememberRaw, signature] = decoded.split(".");
    const shortSignature = "ab";

    expect(
      readMfaChallenge(
        new Request("http://example.test/two-factor-challenge", {
          headers: {
            cookie: `workhub_mfa_pending=${encodeURIComponent(`${userIdRaw}.${issuedAtRaw}.${rememberRaw}.${shortSignature}`)}`,
          },
        }),
      ),
    ).toBeNull();

    const badSignature = `${signature?.slice(0, -1)}${signature?.slice(-1) === "a" ? "b" : "a"}`;
    expect(
      readMfaChallenge(
        new Request("http://example.test/two-factor-challenge", {
          headers: {
            cookie: `workhub_mfa_pending=${encodeURIComponent(`${userIdRaw}.${issuedAtRaw}.${rememberRaw}.${badSignature}`)}`,
          },
        }),
      ),
    ).toBeNull();
  });

  test("adds secure cookie flags in production", () => {
    process.env.APP_ENV = "production";

    expect(createMfaChallengeCookie(1)).toContain("; Secure");
    expect(clearMfaChallengeCookie()).toContain("; Secure");
  });

  test("falls back through session secret environment variables", () => {
    delete process.env.SESSION_SECRET;
    process.env.OAUTH_STATE_SECRET = "oauth-secret";

    const cookie = createMfaChallengeCookie(7);
    expect(readMfaChallenge(new Request("http://example.test/", { headers: { cookie } }))).toEqual({
      userId: 7,
      remember: false,
    });

    delete process.env.OAUTH_STATE_SECRET;
    const fallbackCookie = createMfaChallengeCookie(8);
    expect(
      readMfaChallenge(
        new Request("http://example.test/", { headers: { cookie: fallbackCookie } }),
      ),
    ).toEqual({ userId: 8, remember: false });
  });

  test("defaults to the WorkHub challenge cookie name", () => {
    delete process.env.MFA_CHALLENGE_COOKIE_NAME;

    expect(MFA_CHALLENGE_COOKIE).toBe("workhub_mfa_pending");
    expect(mfaChallengeCookieName()).toBe("workhub_mfa_pending");
    expect(createMfaChallengeCookie(1)).toContain("workhub_mfa_pending=");
    expect(clearMfaChallengeCookie()).toContain("workhub_mfa_pending=");
  });

  test("overrides the challenge cookie name and TTL", () => {
    process.env.MFA_CHALLENGE_COOKIE_NAME = "strata_mfa_pending";
    process.env.MFA_CHALLENGE_TTL_SECONDS = "90";

    expect(mfaChallengeCookieName()).toBe("strata_mfa_pending");
    expect(mfaChallengeTtlSeconds()).toBe(90);

    const cookie = createMfaChallengeCookie(11, { remember: true });
    expect(cookie).toContain("strata_mfa_pending=");
    expect(cookie).toContain("Max-Age=90");
    expect(cookie).not.toContain("workhub_mfa_pending=");

    expect(
      readMfaChallenge(
        new Request("http://example.test/", {
          headers: { cookie: cookie.split(";")[0] ?? "" },
        }),
      ),
    ).toEqual({ userId: 11, remember: true });

    process.env.MFA_CHALLENGE_COOKIE_NAME = "   ";
    process.env.MFA_CHALLENGE_TTL_SECONDS = "nope";
    expect(mfaChallengeCookieName()).toBe("workhub_mfa_pending");
    expect(mfaChallengeTtlSeconds()).toBe(DEFAULT_MFA_CHALLENGE_TTL_SECONDS);

    process.env.MFA_CHALLENGE_TTL_SECONDS = "0";
    expect(mfaChallengeTtlSeconds()).toBe(DEFAULT_MFA_CHALLENGE_TTL_SECONDS);
  });
});
