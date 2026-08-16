import { afterEach, describe, expect, test } from "bun:test";
import { resolveDefaultTokenExpiryDays } from "@getstrata/core/security/tokenExpiry";

describe("resolveDefaultTokenExpiryDays", () => {
  const previous = process.env.API_TOKEN_DEFAULT_EXPIRY_DAYS;

  afterEach(() => {
    if (previous === undefined) {
      delete process.env.API_TOKEN_DEFAULT_EXPIRY_DAYS;
    } else {
      process.env.API_TOKEN_DEFAULT_EXPIRY_DAYS = previous;
    }
  });

  test("returns null when the env var is unset", () => {
    delete process.env.API_TOKEN_DEFAULT_EXPIRY_DAYS;

    expect(resolveDefaultTokenExpiryDays()).toBeNull();
  });

  test("returns null for blank values", () => {
    process.env.API_TOKEN_DEFAULT_EXPIRY_DAYS = "   ";

    expect(resolveDefaultTokenExpiryDays()).toBeNull();
  });

  test("returns null for invalid integers", () => {
    process.env.API_TOKEN_DEFAULT_EXPIRY_DAYS = "0";
    expect(resolveDefaultTokenExpiryDays()).toBeNull();

    process.env.API_TOKEN_DEFAULT_EXPIRY_DAYS = "abc";
    expect(resolveDefaultTokenExpiryDays()).toBeNull();
  });

  test("returns positive integer day counts", () => {
    process.env.API_TOKEN_DEFAULT_EXPIRY_DAYS = "30";

    expect(resolveDefaultTokenExpiryDays()).toBe(30);
  });
});
