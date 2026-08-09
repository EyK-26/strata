import { afterEach, describe, expect, test } from "bun:test";
import { hashApiToken, resolveTokenPepper } from "@getstrata/core/auth/tokenHash";
import { TEST_ADMIN_API_TOKEN } from "../../src/domain/auth";

describe("hashApiToken", () => {
  const originalPepper = process.env.TOKEN_HASH_PEPPER;

  afterEach(() => {
    if (originalPepper === undefined) {
      delete process.env.TOKEN_HASH_PEPPER;
    } else {
      process.env.TOKEN_HASH_PEPPER = originalPepper;
    }
  });

  test("returns a stable sha256 hex digest", () => {
    expect(hashApiToken(TEST_ADMIN_API_TOKEN)).toBe(hashApiToken(TEST_ADMIN_API_TOKEN));
    expect(hashApiToken(TEST_ADMIN_API_TOKEN)).toMatch(/^[a-f0-9]{64}$/);
  });

  test("uses HMAC when a custom pepper is configured", () => {
    process.env.TOKEN_HASH_PEPPER = "custom-pepper-value";

    expect(resolveTokenPepper()).toBe("custom-pepper-value");
    expect(hashApiToken("token-value")).toMatch(/^[a-f0-9]{64}$/);
  });

  test("defaults the pepper from APP_KEY_PREFIX", () => {
    const previousPrefix = process.env.APP_KEY_PREFIX;
    delete process.env.TOKEN_HASH_PEPPER;
    delete process.env.APP_KEY_PREFIX;

    try {
      expect(resolveTokenPepper()).toBe("strata-dev-token-pepper");
      process.env.APP_KEY_PREFIX = "forum";
      expect(resolveTokenPepper()).toBe("forum-dev-token-pepper");
    } finally {
      if (previousPrefix === undefined) {
        delete process.env.APP_KEY_PREFIX;
      } else {
        process.env.APP_KEY_PREFIX = previousPrefix;
      }
    }
  });
});
