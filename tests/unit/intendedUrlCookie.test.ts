import { afterEach, describe, expect, test } from "bun:test";
import {
  clearIntendedUrlCookie,
  createIntendedUrlCookie,
  createIntendedUrlCookieFromRequest,
  DEFAULT_INTENDED_URL_TTL_SECONDS,
  INTENDED_URL_COOKIE,
  intendedUrlCookieName,
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
    const cookie = createIntendedUrlCookie("/account?tab=profile");

    expect(cookie).toContain("workhub_intended=");
    expect(cookie).toContain("Max-Age=86400");

    const request = new Request("http://example.test/verify-email", {
      headers: { cookie: cookie?.split(";")[0] ?? "" },
    });

    expect(readIntendedUrl(request)).toBe("/account?tab=profile");
  });

  test("rejects missing, external, and auth/verify paths", () => {
    expect(createIntendedUrlCookie("")).toBeNull();
    expect(createIntendedUrlCookie("https://evil.example/phish")).toBeNull();
    expect(createIntendedUrlCookie("//evil.example/phish")).toBeNull();
    expect(createIntendedUrlCookie("/login")).toBeNull();
    expect(createIntendedUrlCookie("/email/verify")).toBeNull();
    expect(createIntendedUrlCookie("/oauth/mock")).toBeNull();
    expect(createIntendedUrlCookie("/api/v1/users/me")).toBeNull();
    expect(createIntendedUrlCookie("/api")).toBeNull();
    expect(isStashableIntendedPath("account")).toBe(false);
    expect(isStashableIntendedPath("//evil")).toBe(false);
    expect(isStashableIntendedPath("/invitations/accept?token=abc")).toBe(true);
    expect(isStashableIntendedPath("/account/")).toBe(true);

    expect(readIntendedUrl(new Request("http://example.test/verify-email"))).toBeNull();
    expect(
      readIntendedUrl(
        new Request("http://example.test/verify-email", {
          headers: { cookie: "workhub_session=abc" },
        }),
      ),
    ).toBeNull();
    expect(
      readIntendedUrl(
        new Request("http://example.test/verify-email", {
          headers: { cookie: "workhub_intended=%2Flogin" },
        }),
      ),
    ).toBeNull();
    expect(
      readIntendedUrl(
        new Request("http://example.test/verify-email", {
          headers: { cookie: "workhub_intended=https%3A%2F%2Fevil.example" },
        }),
      ),
    ).toBeNull();
  });

  test("stashes GET and HEAD requests but not mutating methods", () => {
    expect(
      createIntendedUrlCookieFromRequest(new Request("http://example.test/account")),
    ).toContain("workhub_intended=%2Faccount");
    expect(
      createIntendedUrlCookieFromRequest(
        new Request("http://example.test/projects/1?tab=files", { method: "HEAD" }),
      ),
    ).toContain("workhub_intended=%2Fprojects%2F1%3Ftab%3Dfiles");
    expect(
      createIntendedUrlCookieFromRequest(
        new Request("http://example.test/account", { method: "POST" }),
      ),
    ).toBeNull();
    expect(createIntendedUrlCookieFromRequest(new Request("http://example.test/login"))).toBeNull();
  });

  test("adds secure cookie flags in production", () => {
    process.env.APP_ENV = "production";

    expect(createIntendedUrlCookie("/account")).toContain("; Secure");
    expect(clearIntendedUrlCookie()).toContain("; Secure");
  });

  test("defaults to the WorkHub intended cookie name", () => {
    delete process.env.INTENDED_URL_COOKIE_NAME;
    delete process.env.APP_KEY_PREFIX;

    expect(INTENDED_URL_COOKIE).toBe("workhub_intended");
    expect(intendedUrlCookieName()).toBe("strata_intended");
    expect(createIntendedUrlCookie("/account")).toContain("strata_intended=");
    expect(clearIntendedUrlCookie()).toContain("strata_intended=");
    expect(intendedUrlTtlSeconds()).toBe(DEFAULT_INTENDED_URL_TTL_SECONDS);
  });

  test("overrides the cookie name, TTL, and APP_KEY_PREFIX", () => {
    process.env.INTENDED_URL_COOKIE_NAME = "strata_intended";
    process.env.INTENDED_URL_TTL_SECONDS = "90";

    expect(intendedUrlCookieName()).toBe("strata_intended");
    expect(intendedUrlTtlSeconds()).toBe(90);

    const cookie = createIntendedUrlCookie("/reports");
    expect(cookie).toContain("strata_intended=");
    expect(cookie).toContain("Max-Age=90");
    expect(cookie).not.toContain("workhub_intended=");
    expect(
      readIntendedUrl(
        new Request("http://example.test/", {
          headers: { cookie: cookie?.split(";")[0] ?? "" },
        }),
      ),
    ).toBe("/reports");

    process.env.INTENDED_URL_COOKIE_NAME = "   ";
    process.env.INTENDED_URL_TTL_SECONDS = "nope";
    process.env.APP_KEY_PREFIX = "acme";
    expect(intendedUrlCookieName()).toBe("acme_intended");
    expect(intendedUrlTtlSeconds()).toBe(DEFAULT_INTENDED_URL_TTL_SECONDS);

    process.env.INTENDED_URL_TTL_SECONDS = "0";
    expect(intendedUrlTtlSeconds()).toBe(DEFAULT_INTENDED_URL_TTL_SECONDS);
  });
});
