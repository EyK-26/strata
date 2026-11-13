import { afterEach, describe, expect, test } from "bun:test";
import {
  clearIntendedUrlCookie,
  createIntendedUrlCookie,
  createIntendedUrlCookieFromRequest,
  DEFAULT_INTENDED_URL_TTL_SECONDS,
  INTENDED_URL_COOKIE,
  intendedUrlCookieName,
  intendedUrlCookieOptionsFromEnvironment,
  intendedUrlTtlSeconds,
  isStashableIntendedPath,
  readIntendedUrl,
} from "@getstrata/core/auth/intendedUrlCookie";

describe("intendedUrlCookie", () => {
  const originalAppEnv = process.env.APP_ENV;
  const originalCookieName = process.env.INTENDED_URL_COOKIE_NAME;
  const originalTtl = process.env.INTENDED_URL_TTL_SECONDS;
  const originalPrefix = process.env.APP_KEY_PREFIX;

  afterEach(() => {
    if (originalAppEnv === undefined) {
      delete process.env.APP_ENV;
    } else {
      process.env.APP_ENV = originalAppEnv;
    }

    if (originalCookieName === undefined) {
      delete process.env.INTENDED_URL_COOKIE_NAME;
    } else {
      process.env.INTENDED_URL_COOKIE_NAME = originalCookieName;
    }

    if (originalTtl === undefined) {
      delete process.env.INTENDED_URL_TTL_SECONDS;
    } else {
      process.env.INTENDED_URL_TTL_SECONDS = originalTtl;
    }

    if (originalPrefix === undefined) {
      delete process.env.APP_KEY_PREFIX;
    } else {
      process.env.APP_KEY_PREFIX = originalPrefix;
    }
  });

  test("creates and reads a same-origin intended path", () => {
    const cookie = createIntendedUrlCookie(
      "/account?tab=profile",
      intendedUrlCookieOptionsFromEnvironment(process.env),
    );

    expect(cookie).toContain("strata_intended=");
    expect(cookie).toContain("Max-Age=86400");

    const request = new Request("http://example.test/verify-email", {
      headers: { cookie: cookie?.split(";")[0] ?? "" },
    });

    expect(readIntendedUrl(request, intendedUrlCookieOptionsFromEnvironment(process.env))).toBe(
      "/account?tab=profile",
    );
  });

  test("rejects missing, external, and auth/verify paths", () => {
    expect(
      createIntendedUrlCookie("", intendedUrlCookieOptionsFromEnvironment(process.env)),
    ).toBeNull();
    expect(
      createIntendedUrlCookie(
        "https://evil.example/phish",
        intendedUrlCookieOptionsFromEnvironment(process.env),
      ),
    ).toBeNull();
    expect(
      createIntendedUrlCookie(
        "//evil.example/phish",
        intendedUrlCookieOptionsFromEnvironment(process.env),
      ),
    ).toBeNull();
    expect(
      createIntendedUrlCookie("/login", intendedUrlCookieOptionsFromEnvironment(process.env)),
    ).toBeNull();
    expect(
      createIntendedUrlCookie(
        "/email/verify",
        intendedUrlCookieOptionsFromEnvironment(process.env),
      ),
    ).toBeNull();
    expect(
      createIntendedUrlCookie("/oauth/mock", intendedUrlCookieOptionsFromEnvironment(process.env)),
    ).toBeNull();
    expect(
      createIntendedUrlCookie(
        "/api/v1/users/me",
        intendedUrlCookieOptionsFromEnvironment(process.env),
      ),
    ).toBeNull();
    expect(
      createIntendedUrlCookie("/api", intendedUrlCookieOptionsFromEnvironment(process.env)),
    ).toBeNull();
    expect(isStashableIntendedPath("account")).toBe(false);
    expect(isStashableIntendedPath("//evil")).toBe(false);
    expect(isStashableIntendedPath("/invitations/accept?token=abc")).toBe(true);
    expect(isStashableIntendedPath("/account/")).toBe(true);

    expect(
      readIntendedUrl(
        new Request("http://example.test/verify-email"),
        intendedUrlCookieOptionsFromEnvironment(process.env),
      ),
    ).toBeNull();
    expect(
      readIntendedUrl(
        new Request("http://example.test/verify-email", {
          headers: { cookie: "strata_session=abc" },
        }),
        intendedUrlCookieOptionsFromEnvironment(process.env),
      ),
    ).toBeNull();
    expect(
      readIntendedUrl(
        new Request("http://example.test/verify-email", {
          headers: { cookie: "strata_intended=%2Flogin" },
        }),
        intendedUrlCookieOptionsFromEnvironment(process.env),
      ),
    ).toBeNull();
    expect(
      readIntendedUrl(
        new Request("http://example.test/verify-email", {
          headers: { cookie: "strata_intended=https%3A%2F%2Fevil.example" },
        }),
        intendedUrlCookieOptionsFromEnvironment(process.env),
      ),
    ).toBeNull();
  });

  test("stashes GET and HEAD requests but not mutating methods", () => {
    expect(
      createIntendedUrlCookieFromRequest(
        new Request("http://example.test/account"),
        intendedUrlCookieOptionsFromEnvironment(process.env),
      ),
    ).toContain("strata_intended=%2Faccount");
    expect(
      createIntendedUrlCookieFromRequest(
        new Request("http://example.test/projects/1?tab=files", { method: "HEAD" }),
        intendedUrlCookieOptionsFromEnvironment(process.env),
      ),
    ).toContain("strata_intended=%2Fprojects%2F1%3Ftab%3Dfiles");
    expect(
      createIntendedUrlCookieFromRequest(
        new Request("http://example.test/account", { method: "POST" }),
        intendedUrlCookieOptionsFromEnvironment(process.env),
      ),
    ).toBeNull();
    expect(
      createIntendedUrlCookieFromRequest(
        new Request("http://example.test/login"),
        intendedUrlCookieOptionsFromEnvironment(process.env),
      ),
    ).toBeNull();
  });

  test("adds secure cookie flags in production", () => {
    process.env.APP_ENV = "production";

    expect(
      createIntendedUrlCookie("/account", intendedUrlCookieOptionsFromEnvironment(process.env)),
    ).toContain("; Secure");
    expect(clearIntendedUrlCookie(intendedUrlCookieOptionsFromEnvironment(process.env))).toContain(
      "; Secure",
    );
  });

  test("defaults to the Strata intended cookie name", () => {
    delete process.env.INTENDED_URL_COOKIE_NAME;
    delete process.env.APP_KEY_PREFIX;

    expect(INTENDED_URL_COOKIE).toBe("strata_intended");
    expect(intendedUrlCookieName(process.env)).toBe("strata_intended");
    expect(
      createIntendedUrlCookie("/account", intendedUrlCookieOptionsFromEnvironment(process.env)),
    ).toContain("strata_intended=");
    expect(clearIntendedUrlCookie(intendedUrlCookieOptionsFromEnvironment(process.env))).toContain(
      "strata_intended=",
    );
    expect(intendedUrlTtlSeconds(process.env)).toBe(DEFAULT_INTENDED_URL_TTL_SECONDS);
  });

  test("overrides the cookie name, TTL, and APP_KEY_PREFIX", () => {
    process.env.INTENDED_URL_COOKIE_NAME = "acme_next";
    process.env.INTENDED_URL_TTL_SECONDS = "90";

    expect(intendedUrlCookieName(process.env)).toBe("acme_next");
    expect(intendedUrlTtlSeconds(process.env)).toBe(90);

    const cookie = createIntendedUrlCookie(
      "/reports",
      intendedUrlCookieOptionsFromEnvironment(process.env),
    );
    expect(cookie).toContain("acme_next=");
    expect(cookie).toContain("Max-Age=90");
    expect(cookie).not.toContain("strata_intended=");
    expect(
      readIntendedUrl(
        new Request("http://example.test/", {
          headers: { cookie: cookie?.split(";")[0] ?? "" },
        }),
        intendedUrlCookieOptionsFromEnvironment(process.env),
      ),
    ).toBe("/reports");

    process.env.INTENDED_URL_COOKIE_NAME = "   ";
    process.env.INTENDED_URL_TTL_SECONDS = "nope";
    process.env.APP_KEY_PREFIX = "acme";
    expect(intendedUrlCookieName(process.env)).toBe("acme_intended");
    expect(intendedUrlTtlSeconds(process.env)).toBe(DEFAULT_INTENDED_URL_TTL_SECONDS);

    process.env.INTENDED_URL_TTL_SECONDS = "0";
    expect(intendedUrlTtlSeconds(process.env)).toBe(DEFAULT_INTENDED_URL_TTL_SECONDS);
  });
});
