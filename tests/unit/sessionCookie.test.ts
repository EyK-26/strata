import { afterEach, describe, expect, test } from "bun:test";
import {
  clearSessionCookie,
  createSessionCookie,
  readSessionUserId,
  SESSION_TTL_SECONDS,
} from "../../src/core/auth/sessionCookie";

describe("sessionCookie", () => {
  const originalAppEnv = process.env.APP_ENV;
  const originalSessionSecret = process.env.SESSION_SECRET;
  const originalOAuthStateSecret = process.env.OAUTH_STATE_SECRET;
  const originalAdminApiToken = process.env.ADMIN_API_TOKEN;

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
  });

  test("creates and reads a signed session cookie", () => {
    const cookiePair = createSessionCookie(42).split(";")[0] ?? "";
    const request = new Request("http://example.test/organizations", {
      headers: {
        cookie: cookiePair,
      },
    });

    expect(readSessionUserId(request)).toBe(42);
  });

  test("rejects tampered session cookies", () => {
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
});
