import { afterEach, describe, expect, test } from "bun:test";
import { createHmac } from "node:crypto";
import {
  clearSessionCookie,
  createSessionCookie,
  createSessionCookieDetails,
  createSessionReader,
  isSessionInvalidated,
  readSession,
  readSessionUserId,
  SESSION_COOKIE,
  SESSION_REMEMBER_TTL_SECONDS,
  SESSION_TTL_SECONDS,
  sessionCookieName,
  sessionCookieOptionsFromEnvironment,
  sessionRememberTtlSeconds,
  sessionTtlSeconds,
} from "@getstrata/core/auth/sessionCookie";
import { appCookieName } from "@getstrata/core/runtime/appKeyPrefix";

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
    const cookiePair =
      createSessionCookie(42, {}, sessionCookieOptionsFromEnvironment(process.env)).split(";")[0] ??
      "";
    const request = new Request("http://example.test/login", {
      headers: {
        cookie: cookiePair,
      },
    });

    expect(readSessionUserId(request, sessionCookieOptionsFromEnvironment(process.env))).toBe(42);
    const session = readSession(request, sessionCookieOptionsFromEnvironment(process.env));
    expect(session?.userId).toBe(42);
    expect(session?.issuedAt).toBeGreaterThan(0);
  });

  test("createSessionCookieDetails exposes issuedAt and ttl", () => {
    const details = createSessionCookieDetails(
      11,
      {},
      sessionCookieOptionsFromEnvironment(process.env),
    );
    const cookiePair = details.header.split(";")[0] ?? "";
    const session = readSession(
      new Request("http://example.test/", { headers: { cookie: cookiePair } }),
      sessionCookieOptionsFromEnvironment(process.env),
    );

    expect(details.userId).toBe(11);
    expect(details.ttlSeconds).toBe(sessionTtlSeconds(process.env));
    expect(session?.issuedAt).toBe(details.issuedAt);

    const remembered = createSessionCookieDetails(
      11,
      { remember: true },
      sessionCookieOptionsFromEnvironment(process.env),
    );
    expect(remembered.ttlSeconds).toBe(sessionRememberTtlSeconds(process.env));
  });

  test("rejects tampered session cookies", () => {
    expect(
      readSessionUserId(
        new Request("http://example.test/login"),
        sessionCookieOptionsFromEnvironment(process.env),
      ),
    ).toBeNull();

    const request = new Request("http://example.test/login", {
      headers: {
        cookie: "strata_session=999.123.deadbeef",
      },
    });

    expect(readSessionUserId(request, sessionCookieOptionsFromEnvironment(process.env))).toBeNull();
  });

  test("rejects malformed, expired, and invalid signature cookies", () => {
    expect(
      readSessionUserId(
        new Request("http://example.test/", {
          headers: { cookie: "strata_session=1.2" },
        }),
        sessionCookieOptionsFromEnvironment(process.env),
      ),
    ).toBeNull();

    expect(
      readSessionUserId(
        new Request("http://example.test/", {
          headers: { cookie: "strata_session=0.123.sig" },
        }),
        sessionCookieOptionsFromEnvironment(process.env),
      ),
    ).toBeNull();

    const expiredIssuedAt = Date.now() - SESSION_TTL_SECONDS * 1000 - 1_000;
    expect(
      readSessionUserId(
        new Request("http://example.test/", {
          headers: {
            cookie: `strata_session=${encodeURIComponent(`42.${expiredIssuedAt}.deadbeef`)}`,
          },
        }),
        sessionCookieOptionsFromEnvironment(process.env),
      ),
    ).toBeNull();

    const validCookie =
      createSessionCookie(42, {}, sessionCookieOptionsFromEnvironment(process.env))
        .split(";")[0]
        ?.split("=")[1] ?? "";
    const decoded = decodeURIComponent(validCookie);
    const [userIdRaw, issuedAtRaw] = decoded.split(".");
    const tampered = `${userIdRaw}.${issuedAtRaw}.short`;

    expect(
      readSessionUserId(
        new Request("http://example.test/", {
          headers: { cookie: `strata_session=${encodeURIComponent(tampered)}` },
        }),
        sessionCookieOptionsFromEnvironment(process.env),
      ),
    ).toBeNull();

    expect(
      readSessionUserId(
        new Request("http://example.test/", {
          headers: {
            cookie: `strata_session=${encodeURIComponent(`${userIdRaw}.${issuedAtRaw}.`)}`,
          },
        }),
        sessionCookieOptionsFromEnvironment(process.env),
      ),
    ).toBeNull();
  });

  test("adds secure cookie flags in production", () => {
    process.env.APP_ENV = "production";
    process.env.SESSION_SECRET = "explicit-production-test-session-secret";

    expect(createSessionCookie(1, {}, sessionCookieOptionsFromEnvironment(process.env))).toContain(
      "; Secure",
    );
    expect(clearSessionCookie(sessionCookieOptionsFromEnvironment(process.env))).toContain(
      "; Secure",
    );
  });

  test("falls back through session secret environment variables", () => {
    delete process.env.SESSION_SECRET;
    process.env.OAUTH_STATE_SECRET = "oauth-secret";

    const cookie = createSessionCookie(7, {}, sessionCookieOptionsFromEnvironment(process.env));
    expect(
      readSessionUserId(
        new Request("http://example.test/", { headers: { cookie } }),
        sessionCookieOptionsFromEnvironment(process.env),
      ),
    ).toBe(7);

    delete process.env.OAUTH_STATE_SECRET;
    process.env.ADMIN_API_TOKEN = "admin-secret";

    const fallbackCookie = createSessionCookie(
      8,
      {},
      sessionCookieOptionsFromEnvironment(process.env),
    );
    expect(
      readSessionUserId(
        new Request("http://example.test/", { headers: { cookie: fallbackCookie } }),
        sessionCookieOptionsFromEnvironment(process.env),
      ),
    ).toBe(8);
  });

  test("reads cookie values that contain equals signs and rejects equal-length bad signatures", () => {
    const cookiePair =
      createSessionCookie(42, {}, sessionCookieOptionsFromEnvironment(process.env)).split(";")[0] ??
      "";
    const encoded = cookiePair.split("=")[1] ?? "";
    const request = new Request("http://example.test/", {
      headers: { cookie: `${sessionCookieName(process.env)}=${encoded}` },
    });

    expect(readSessionUserId(request, sessionCookieOptionsFromEnvironment(process.env))).toBe(42);

    const decoded = decodeURIComponent(encoded);
    const [userIdRaw, issuedAtRaw, signature] = decoded.split(".");
    const badSignature = `${signature?.slice(0, -1)}${signature?.slice(-1) === "a" ? "b" : "a"}`;

    expect(
      readSessionUserId(
        new Request("http://example.test/", {
          headers: {
            cookie: `${sessionCookieName(process.env)}=${encodeURIComponent(`${userIdRaw}.${issuedAtRaw}.${badSignature}`)}`,
          },
        }),
        sessionCookieOptionsFromEnvironment(process.env),
      ),
    ).toBeNull();
  });

  test("defaults to the Strata session cookie name when APP_KEY_PREFIX is pinned", () => {
    delete process.env.SESSION_COOKIE_NAME;

    expect(SESSION_COOKIE).toBe(appCookieName("session"));
    expect(sessionCookieName(process.env)).toBe(appCookieName("session"));
    expect(createSessionCookie(1, {}, sessionCookieOptionsFromEnvironment(process.env))).toContain(
      `${appCookieName("session")}=`,
    );
    expect(clearSessionCookie(sessionCookieOptionsFromEnvironment(process.env))).toContain(
      `${appCookieName("session")}=`,
    );
  });

  test("derives the session cookie name from APP_KEY_PREFIX", () => {
    const previousPrefix = process.env.APP_KEY_PREFIX;
    delete process.env.SESSION_COOKIE_NAME;
    process.env.APP_KEY_PREFIX = "forum";

    try {
      expect(sessionCookieName(process.env)).toBe("forum_session");
      expect(
        createSessionCookie(11, {}, sessionCookieOptionsFromEnvironment(process.env)),
      ).toContain("forum_session=");
    } finally {
      if (previousPrefix === undefined) {
        delete process.env.APP_KEY_PREFIX;
      } else {
        process.env.APP_KEY_PREFIX = previousPrefix;
      }
    }
  });

  test("overrides the HMAC session cookie name from SESSION_COOKIE_NAME", () => {
    process.env.SESSION_COOKIE_NAME = "hiring_session";

    expect(sessionCookieName(process.env)).toBe("hiring_session");

    const cookie = createSessionCookie(11, {}, sessionCookieOptionsFromEnvironment(process.env));
    expect(cookie).toContain("hiring_session=");
    expect(cookie).not.toContain(`${appCookieName("session")}=`);

    expect(
      readSessionUserId(
        new Request("http://example.test/", {
          headers: { cookie: cookie.split(";")[0] ?? "" },
        }),
        sessionCookieOptionsFromEnvironment(process.env),
      ),
    ).toBe(11);

    expect(
      readSessionUserId(
        new Request("http://example.test/", {
          headers: { cookie: `${appCookieName("session")}=11.1.deadbeef` },
        }),
        sessionCookieOptionsFromEnvironment(process.env),
      ),
    ).toBeNull();

    process.env.SESSION_COOKIE_NAME = "   ";
    expect(sessionCookieName(process.env)).toBe(appCookieName("session"));
  });

  test("creates a longer remember-me cookie that stays valid past the session TTL", () => {
    const cookie = createSessionCookie(
      42,
      { remember: true },
      sessionCookieOptionsFromEnvironment(process.env),
    );
    expect(cookie).toContain(`Max-Age=${SESSION_REMEMBER_TTL_SECONDS}`);

    const pair = cookie.split(";")[0] ?? "";
    const request = new Request("http://example.test/", { headers: { cookie: pair } });
    expect(readSessionUserId(request, sessionCookieOptionsFromEnvironment(process.env))).toBe(42);

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
          headers: { cookie: `strata_session=${encodeURIComponent(`42.${now}.0.deadbeef`)}` },
        }),
        sessionCookieOptionsFromEnvironment(process.env),
      ),
    ).toBeNull();

    expect(
      readSessionUserId(
        new Request("http://example.test/", {
          headers: { cookie: `strata_session=${encodeURIComponent(`42.${now}.abc.deadbeef`)}` },
        }),
        sessionCookieOptionsFromEnvironment(process.env),
      ),
    ).toBeNull();

    const expiredIssuedAt = now - SESSION_REMEMBER_TTL_SECONDS * 1000 - 1_000;
    expect(
      readSessionUserId(
        new Request("http://example.test/", {
          headers: {
            cookie: `strata_session=${encodeURIComponent(`${42}.${expiredIssuedAt}.${SESSION_REMEMBER_TTL_SECONDS}.deadbeef`)}`,
          },
        }),
        sessionCookieOptionsFromEnvironment(process.env),
      ),
    ).toBeNull();

    expect(
      readSessionUserId(
        new Request("http://example.test/", {
          headers: {
            cookie: `strata_session=${encodeURIComponent(`42.${now}.${SESSION_REMEMBER_TTL_SECONDS}.`)}`,
          },
        }),
        sessionCookieOptionsFromEnvironment(process.env),
      ),
    ).toBeNull();

    const validCookie =
      createSessionCookie(42, { remember: true }, sessionCookieOptionsFromEnvironment(process.env))
        .split(";")[0]
        ?.split("=")[1] ?? "";
    const decoded = decodeURIComponent(validCookie);
    const [userIdRaw, issuedAtRaw, ttlRaw, signature] = decoded.split(".");
    const shortSignature = "ab";

    expect(
      readSessionUserId(
        new Request("http://example.test/", {
          headers: {
            cookie: `strata_session=${encodeURIComponent(`${userIdRaw}.${issuedAtRaw}.${ttlRaw}.${shortSignature}`)}`,
          },
        }),
        sessionCookieOptionsFromEnvironment(process.env),
      ),
    ).toBeNull();

    const badSignature = `${signature?.slice(0, -1)}${signature?.slice(-1) === "a" ? "b" : "a"}`;
    expect(
      readSessionUserId(
        new Request("http://example.test/", {
          headers: {
            cookie: `strata_session=${encodeURIComponent(`${userIdRaw}.${issuedAtRaw}.${ttlRaw}.${badSignature}`)}`,
          },
        }),
        sessionCookieOptionsFromEnvironment(process.env),
      ),
    ).toBeNull();

    expect(
      readSessionUserId(
        new Request("http://example.test/", {
          headers: {
            cookie: `strata_session=${encodeURIComponent(`0.${now}.${SESSION_REMEMBER_TTL_SECONDS}.deadbeef`)}`,
          },
        }),
        sessionCookieOptionsFromEnvironment(process.env),
      ),
    ).toBeNull();
  });

  test("overrides session and remember TTLs from the environment", () => {
    process.env.SESSION_TTL_SECONDS = "120";
    process.env.SESSION_REMEMBER_TTL_SECONDS = "3600";

    expect(sessionTtlSeconds(process.env)).toBe(120);
    expect(sessionRememberTtlSeconds(process.env)).toBe(3600);
    expect(createSessionCookie(3, {}, sessionCookieOptionsFromEnvironment(process.env))).toContain(
      "Max-Age=120",
    );
    expect(
      createSessionCookie(3, { remember: true }, sessionCookieOptionsFromEnvironment(process.env)),
    ).toContain("Max-Age=3600");

    process.env.SESSION_TTL_SECONDS = "0";
    process.env.SESSION_REMEMBER_TTL_SECONDS = "nope";
    expect(() => sessionTtlSeconds(process.env)).toThrow("SESSION_TTL_SECONDS");
    expect(() => sessionRememberTtlSeconds(process.env)).toThrow("SESSION_REMEMBER_TTL_SECONDS");
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

test("session reader rejects invalid captured TTL and preserves valid configuration before decoding", () => {
  const secret = "explicit-reader-fixture-secret";
  for (const ttlSeconds of [0, -1, 0.5, Number.NaN])
    expect(() =>
      createSessionReader({ cookieName: "captured_session", secret, ttlSeconds }),
    ).toThrow("Invalid session reader configuration");
  const configuration = { cookieName: "captured_session", secret, ttlSeconds: 60 };
  const reader = createSessionReader(configuration);
  configuration.ttlSeconds = 0;
  configuration.cookieName = "changed_session";
  configuration.secret = "changed-secret";
  const issuedAt = Date.now() - 1000;
  const payload = `42.${issuedAt}`;
  const signature = createHmac("sha256", secret).update(payload).digest("hex");
  const encoded = encodeURIComponent(`${payload}.${signature}`);
  expect(
    reader(
      new Request("http://example.test", { headers: { cookie: `captured_session=${encoded}` } }),
    ),
  ).toEqual({ userId: 42, issuedAt });
  expect(
    reader(
      new Request("http://example.test", { headers: { cookie: `changed_session=${encoded}` } }),
    ),
  ).toBeNull();
});
