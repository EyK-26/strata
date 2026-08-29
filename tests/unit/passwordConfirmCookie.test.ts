import { afterEach, describe, expect, test } from "bun:test";
import {
  clearPasswordConfirmCookie,
  createPasswordConfirmCookie,
  DEFAULT_PASSWORD_CONFIRM_TTL_SECONDS,
  hasFreshPasswordConfirmation,
  PASSWORD_CONFIRM_COOKIE,
  passwordConfirmCookieName,
  passwordConfirmTtlSeconds,
} from "@getstrata/core/auth/passwordConfirmCookie";

describe("passwordConfirmCookie", () => {
  const originalAppEnv = process.env.APP_ENV;
  const originalSessionSecret = process.env.SESSION_SECRET;
  const originalOAuthStateSecret = process.env.OAUTH_STATE_SECRET;
  const originalCookieName = process.env.PASSWORD_CONFIRM_COOKIE_NAME;
  const originalTimeout = process.env.PASSWORD_CONFIRM_TIMEOUT;

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
      delete process.env.PASSWORD_CONFIRM_COOKIE_NAME;
    } else {
      process.env.PASSWORD_CONFIRM_COOKIE_NAME = originalCookieName;
    }

    if (originalTimeout === undefined) {
      delete process.env.PASSWORD_CONFIRM_TIMEOUT;
    } else {
      process.env.PASSWORD_CONFIRM_TIMEOUT = originalTimeout;
    }
  });

  test("creates and reads a signed confirmation cookie", () => {
    const cookiePair = createPasswordConfirmCookie(42).split(";")[0] ?? "";
    const request = new Request("http://example.test/account/export", {
      headers: { cookie: cookiePair },
    });

    expect(hasFreshPasswordConfirmation(request, 42)).toBe(true);
    expect(hasFreshPasswordConfirmation(request, 7)).toBe(false);
  });

  test("rejects missing, malformed, expired, and tampered cookies", () => {
    expect(
      hasFreshPasswordConfirmation(new Request("http://example.test/account/export"), 42),
    ).toBe(false);

    expect(
      hasFreshPasswordConfirmation(
        new Request("http://example.test/account/export", {
          headers: { cookie: "workhub_session=1.2.deadbeef" },
        }),
        42,
      ),
    ).toBe(false);

    expect(
      hasFreshPasswordConfirmation(
        new Request("http://example.test/account/export", {
          headers: { cookie: "workhub_password_confirmed=1.2" },
        }),
        1,
      ),
    ).toBe(false);

    expect(
      hasFreshPasswordConfirmation(
        new Request("http://example.test/account/export", {
          headers: { cookie: "workhub_password_confirmed=0.123.deadbeef" },
        }),
        1,
      ),
    ).toBe(false);

    expect(
      hasFreshPasswordConfirmation(
        new Request("http://example.test/account/export", {
          headers: { cookie: "workhub_password_confirmed=1.abc.deadbeef" },
        }),
        1,
      ),
    ).toBe(false);

    const expiredConfirmedAt = Date.now() - DEFAULT_PASSWORD_CONFIRM_TTL_SECONDS * 1000 - 1_000;
    expect(
      hasFreshPasswordConfirmation(
        new Request("http://example.test/account/export", {
          headers: {
            cookie: `workhub_password_confirmed=${encodeURIComponent(`${42}.${expiredConfirmedAt}.deadbeef`)}`,
          },
        }),
        42,
      ),
    ).toBe(false);

    const freshConfirmedAt = Date.now();
    expect(
      hasFreshPasswordConfirmation(
        new Request("http://example.test/account/export", {
          headers: { cookie: `workhub_password_confirmed=1.${freshConfirmedAt}.` },
        }),
        1,
      ),
    ).toBe(false);

    const validCookie = createPasswordConfirmCookie(42).split(";")[0]?.split("=")[1] ?? "";
    const decoded = decodeURIComponent(validCookie);
    const [userIdRaw, confirmedAtRaw, signature] = decoded.split(".");
    const shortSignature = "ab";

    expect(
      hasFreshPasswordConfirmation(
        new Request("http://example.test/account/export", {
          headers: {
            cookie: `workhub_password_confirmed=${encodeURIComponent(`${userIdRaw}.${confirmedAtRaw}.${shortSignature}`)}`,
          },
        }),
        42,
      ),
    ).toBe(false);

    const badSignature = `${signature?.slice(0, -1)}${signature?.slice(-1) === "a" ? "b" : "a"}`;
    expect(
      hasFreshPasswordConfirmation(
        new Request("http://example.test/account/export", {
          headers: {
            cookie: `workhub_password_confirmed=${encodeURIComponent(`${userIdRaw}.${confirmedAtRaw}.${badSignature}`)}`,
          },
        }),
        42,
      ),
    ).toBe(false);
  });

  test("adds secure cookie flags in production", () => {
    process.env.APP_ENV = "production";

    expect(createPasswordConfirmCookie(1)).toContain("; Secure");
    expect(clearPasswordConfirmCookie()).toContain("; Secure");
  });

  test("falls back through session secret environment variables", () => {
    delete process.env.SESSION_SECRET;
    process.env.OAUTH_STATE_SECRET = "oauth-secret";

    const cookie = createPasswordConfirmCookie(7);
    expect(
      hasFreshPasswordConfirmation(new Request("http://example.test/", { headers: { cookie } }), 7),
    ).toBe(true);

    delete process.env.OAUTH_STATE_SECRET;
    const fallbackCookie = createPasswordConfirmCookie(8);
    expect(
      hasFreshPasswordConfirmation(
        new Request("http://example.test/", { headers: { cookie: fallbackCookie } }),
        8,
      ),
    ).toBe(true);
  });

  test("defaults to the WorkHub confirmation cookie name", () => {
    delete process.env.PASSWORD_CONFIRM_COOKIE_NAME;

    expect(PASSWORD_CONFIRM_COOKIE).toBe("workhub_password_confirmed");
    expect(passwordConfirmCookieName()).toBe("workhub_password_confirmed");
    expect(createPasswordConfirmCookie(1)).toContain("workhub_password_confirmed=");
    expect(clearPasswordConfirmCookie()).toContain("workhub_password_confirmed=");
  });

  test("overrides the confirmation cookie name and TTL", () => {
    process.env.PASSWORD_CONFIRM_COOKIE_NAME = "strata_password_confirmed";
    process.env.PASSWORD_CONFIRM_TIMEOUT = "90";

    expect(passwordConfirmCookieName()).toBe("strata_password_confirmed");
    expect(passwordConfirmTtlSeconds()).toBe(90);

    const cookie = createPasswordConfirmCookie(11);
    expect(cookie).toContain("strata_password_confirmed=");
    expect(cookie).toContain("Max-Age=90");
    expect(cookie).not.toContain("workhub_password_confirmed=");

    expect(
      hasFreshPasswordConfirmation(
        new Request("http://example.test/", {
          headers: { cookie: cookie.split(";")[0] ?? "" },
        }),
        11,
      ),
    ).toBe(true);

    process.env.PASSWORD_CONFIRM_COOKIE_NAME = "   ";
    process.env.PASSWORD_CONFIRM_TIMEOUT = "nope";
    expect(passwordConfirmCookieName()).toBe("workhub_password_confirmed");
    expect(passwordConfirmTtlSeconds()).toBe(DEFAULT_PASSWORD_CONFIRM_TTL_SECONDS);

    process.env.PASSWORD_CONFIRM_TIMEOUT = "0";
    expect(passwordConfirmTtlSeconds()).toBe(DEFAULT_PASSWORD_CONFIRM_TTL_SECONDS);
  });
});
