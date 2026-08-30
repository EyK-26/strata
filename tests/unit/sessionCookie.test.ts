import { afterEach, describe, expect, test } from "bun:test";
import {
  clearSessionCookie,
  createSessionCookie,
  isSessionInvalidated,
  readSession,
  readSessionUserId,
  SESSION_COOKIE,
  SESSION_REMEMBER_TTL_SECONDS,
  SESSION_TTL_SECONDS,
  sessionCookieName,
  sessionRememberTtlSeconds,
  sessionTtlSeconds,
} from "@getstrata/core/auth/sessionCookie";

describe("sessionCookie", () => {
  const originalAppEnv = process.env.APP_ENV;
  const originalSessionSecret = process.env.SESSION_SECRET;
  const originalOAuthStateSecret = process.env.OAUTH_STATE_SECRET;
  const originalAdminApiToken = process.env.ADMIN_API_TOKEN;
  const originalSessionCookieName = process.env.SESSION_COOKIE_NAME;
  const originalSessionTtl = process.env.SESSION_TTL_SECONDS;
  const originalRememberTtl = process.env.SESSION_REMEMBER_TTL_SECONDS;

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

    if (originalAdminApiToken === undefined) {
      delete process.env.ADMIN_API_TOKEN;
    } else {
      process.env.ADMIN_API_TOKEN = originalAdminApiToken;
    }

    if (originalSessionCookieName === undefined) {
      delete process.env.SESSION_COOKIE_NAME;
    } else {
      process.env.SESSION_COOKIE_NAME = originalSessionCookieName;
    }

    if (originalSessionTtl === undefined) {
      delete process.env.SESSION_TTL_SECONDS;
    } else {
      process.env.SESSION_TTL_SECONDS = originalSessionTtl;
    }

    if (originalRememberTtl === undefined) {
      delete process.env.SESSION_REMEMBER_TTL_SECONDS;
    } else {
      process.env.SESSION_REMEMBER_TTL_SECONDS = originalRememberTtl;
    }
  });

  test("creates and reads a signed session cookie", () => {
    const cookiePair = createSessionCookie(42).split(";")[0] ?? "";
    const request = new Request("http://example.test/organizations", {
      headers: {
        cookie: cookiePair,
      },
    });

    expect(readSessionUserId(request)).toBe(42);
    const session = readSession(request);
    expect(session?.userId).toBe(42);
    expect(session?.issuedAt).toBeGreaterThan(0);
  });

  test("rejects tampered session cookies", () => {
    expect(readSessionUserId(new Request("http://example.test/organizations"))).toBeNull();

    const request = new Request("http://example.test/organizations", {
      headers: {
        cookie: "workhub_session=999.123.deadbeef",
      },
    });

    expect(readSessionUserId(request)).toBeNull();
  });

  test("rejects malformed, expired, and invalid signature cookies", () => {
    expect(
      readSessionUserId(
        new Request("http://example.test/", {
          headers: { cookie: "workhub_session=1.2" },
        }),
      ),
    ).toBeNull();

    expect(
      readSessionUserId(
        new Request("http://example.test/", {
          headers: { cookie: "workhub_session=0.123.sig" },
        }),
      ),
    ).toBeNull();

    const expiredIssuedAt = Date.now() - SESSION_TTL_SECONDS * 1000 - 1_000;
    expect(
      readSessionUserId(
        new Request("http://example.test/", {
          headers: {
            cookie: `workhub_session=${encodeURIComponent(`42.${expiredIssuedAt}.deadbeef`)}`,
          },
        }),
      ),
    ).toBeNull();

    const validCookie = createSessionCookie(42).split(";")[0]?.split("=")[1] ?? "";
    const decoded = decodeURIComponent(validCookie);
    const [userIdRaw, issuedAtRaw] = decoded.split(".");
    const tampered = `${userIdRaw}.${issuedAtRaw}.short`;

    expect(
      readSessionUserId(
        new Request("http://example.test/", {
          headers: { cookie: `workhub_session=${encodeURIComponent(tampered)}` },
        }),
      ),
    ).toBeNull();

    expect(
      readSessionUserId(
        new Request("http://example.test/", {
          headers: {
            cookie: `workhub_session=${encodeURIComponent(`${userIdRaw}.${issuedAtRaw}.`)}`,
          },
        }),
      ),
    ).toBeNull();
  });

  test("adds secure cookie flags in production", () => {
    process.env.APP_ENV = "production";

    expect(createSessionCookie(1)).toContain("; Secure");
    expect(clearSessionCookie()).toContain("; Secure");
  });

  test("falls back through session secret environment variables", () => {
    delete process.env.SESSION_SECRET;
    process.env.OAUTH_STATE_SECRET = "oauth-secret";

    const cookie = createSessionCookie(7);
    expect(readSessionUserId(new Request("http://example.test/", { headers: { cookie } }))).toBe(7);

    delete process.env.OAUTH_STATE_SECRET;
    process.env.ADMIN_API_TOKEN = "admin-secret";

    const fallbackCookie = createSessionCookie(8);
    expect(
      readSessionUserId(
        new Request("http://example.test/", { headers: { cookie: fallbackCookie } }),
      ),
    ).toBe(8);
  });

  test("reads cookie values that contain equals signs and rejects equal-length bad signatures", () => {
    const cookiePair = createSessionCookie(42).split(";")[0] ?? "";
    const encoded = cookiePair.split("=")[1] ?? "";
    const request = new Request("http://example.test/", {
      headers: { cookie: `workhub_session=${encoded}` },
    });

    expect(readSessionUserId(request)).toBe(42);

    const decoded = decodeURIComponent(encoded);
    const [userIdRaw, issuedAtRaw, signature] = decoded.split(".");
    const badSignature = `${signature?.slice(0, -1)}${signature?.slice(-1) === "a" ? "b" : "a"}`;

    expect(
      readSessionUserId(
        new Request("http://example.test/", {
          headers: {
            cookie: `workhub_session=${encodeURIComponent(`${userIdRaw}.${issuedAtRaw}.${badSignature}`)}`,
          },
        }),
      ),
    ).toBeNull();
  });

  test("defaults to the WorkHub session cookie name", () => {
    delete process.env.SESSION_COOKIE_NAME;

    expect(SESSION_COOKIE).toBe("workhub_session");
    expect(sessionCookieName()).toBe("workhub_session");
    expect(createSessionCookie(1)).toContain("workhub_session=");
    expect(clearSessionCookie()).toContain("workhub_session=");
  });

  test("derives the session cookie name from APP_KEY_PREFIX", () => {
    const previousPrefix = process.env.APP_KEY_PREFIX;
    delete process.env.SESSION_COOKIE_NAME;
    process.env.APP_KEY_PREFIX = "forum";

    try {
      expect(sessionCookieName()).toBe("forum_session");
      expect(createSessionCookie(11)).toContain("forum_session=");
    } finally {
      if (previousPrefix === undefined) {
        delete process.env.APP_KEY_PREFIX;
      } else {
        process.env.APP_KEY_PREFIX = previousPrefix;
      }
    }
  });

  test("overrides the HMAC session cookie name from SESSION_COOKIE_NAME", () => {
    process.env.SESSION_COOKIE_NAME = "strata_session";

    expect(sessionCookieName()).toBe("strata_session");

    const cookie = createSessionCookie(11);
    expect(cookie).toContain("strata_session=");
    expect(cookie).not.toContain("workhub_session=");

    expect(
      readSessionUserId(
        new Request("http://example.test/", {
          headers: { cookie: cookie.split(";")[0] ?? "" },
        }),
      ),
    ).toBe(11);

    expect(
      readSessionUserId(
        new Request("http://example.test/", {
          headers: { cookie: "workhub_session=11.1.deadbeef" },
        }),
      ),
    ).toBeNull();

    process.env.SESSION_COOKIE_NAME = "   ";
    expect(sessionCookieName()).toBe("workhub_session");
  });

  test("creates a longer remember-me cookie that stays valid past the session TTL", () => {
    const cookie = createSessionCookie(42, { remember: true });
    expect(cookie).toContain(`Max-Age=${SESSION_REMEMBER_TTL_SECONDS}`);

    const pair = cookie.split(";")[0] ?? "";
    const request = new Request("http://example.test/", { headers: { cookie: pair } });
    expect(readSessionUserId(request)).toBe(42);

    const encoded = pair.split("=")[1] ?? "";
    const decoded = decodeURIComponent(encoded);
    const parts = decoded.split(".");
    expect(parts).toHaveLength(4);
    expect(parts[2]).toBe(String(SESSION_REMEMBER_TTL_SECONDS));
  });

  test("rejects malformed, expired, and invalid remember-me cookies", () => {
    const now = Date.now();

    expect(
      readSessionUserId(
        new Request("http://example.test/", {
          headers: { cookie: `workhub_session=${encodeURIComponent(`42.${now}.0.deadbeef`)}` },
        }),
      ),
    ).toBeNull();

    expect(
      readSessionUserId(
        new Request("http://example.test/", {
          headers: { cookie: `workhub_session=${encodeURIComponent(`42.${now}.abc.deadbeef`)}` },
        }),
      ),
    ).toBeNull();

    const expiredIssuedAt = now - SESSION_REMEMBER_TTL_SECONDS * 1000 - 1_000;
    expect(
      readSessionUserId(
        new Request("http://example.test/", {
          headers: {
            cookie: `workhub_session=${encodeURIComponent(`${42}.${expiredIssuedAt}.${SESSION_REMEMBER_TTL_SECONDS}.deadbeef`)}`,
          },
        }),
      ),
    ).toBeNull();

    expect(
      readSessionUserId(
        new Request("http://example.test/", {
          headers: {
            cookie: `workhub_session=${encodeURIComponent(`42.${now}.${SESSION_REMEMBER_TTL_SECONDS}.`)}`,
          },
        }),
      ),
    ).toBeNull();

    const validCookie =
      createSessionCookie(42, { remember: true }).split(";")[0]?.split("=")[1] ?? "";
    const decoded = decodeURIComponent(validCookie);
    const [userIdRaw, issuedAtRaw, ttlRaw, signature] = decoded.split(".");
    const shortSignature = "ab";

    expect(
      readSessionUserId(
        new Request("http://example.test/", {
          headers: {
            cookie: `workhub_session=${encodeURIComponent(`${userIdRaw}.${issuedAtRaw}.${ttlRaw}.${shortSignature}`)}`,
          },
        }),
      ),
    ).toBeNull();

    const badSignature = `${signature?.slice(0, -1)}${signature?.slice(-1) === "a" ? "b" : "a"}`;
    expect(
      readSessionUserId(
        new Request("http://example.test/", {
          headers: {
            cookie: `workhub_session=${encodeURIComponent(`${userIdRaw}.${issuedAtRaw}.${ttlRaw}.${badSignature}`)}`,
          },
        }),
      ),
    ).toBeNull();

    expect(
      readSessionUserId(
        new Request("http://example.test/", {
          headers: {
            cookie: `workhub_session=${encodeURIComponent(`0.${now}.${SESSION_REMEMBER_TTL_SECONDS}.deadbeef`)}`,
          },
        }),
      ),
    ).toBeNull();
  });

  test("overrides session and remember TTLs from the environment", () => {
    process.env.SESSION_TTL_SECONDS = "120";
    process.env.SESSION_REMEMBER_TTL_SECONDS = "3600";

    expect(sessionTtlSeconds()).toBe(120);
    expect(sessionRememberTtlSeconds()).toBe(3600);
    expect(createSessionCookie(3)).toContain("Max-Age=120");
    expect(createSessionCookie(3, { remember: true })).toContain("Max-Age=3600");

    process.env.SESSION_TTL_SECONDS = "0";
    process.env.SESSION_REMEMBER_TTL_SECONDS = "nope";
    expect(sessionTtlSeconds()).toBe(SESSION_TTL_SECONDS);
    expect(sessionRememberTtlSeconds()).toBe(SESSION_REMEMBER_TTL_SECONDS);
  });

  test("isSessionInvalidated compares issuedAt against session_valid_after", () => {
    expect(isSessionInvalidated(100, null)).toBe(false);
    expect(isSessionInvalidated(100, undefined)).toBe(false);
    expect(isSessionInvalidated(100, "not-a-date")).toBe(false);
    expect(isSessionInvalidated(200, new Date(100))).toBe(false);
    expect(isSessionInvalidated(100, new Date(200))).toBe(true);
    expect(isSessionInvalidated(100, new Date(100).toISOString())).toBe(false);
    expect(isSessionInvalidated(99, new Date(100).toISOString())).toBe(true);
  });
});
