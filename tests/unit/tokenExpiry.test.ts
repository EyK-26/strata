import { afterEach, describe, expect, test } from "bun:test";
import { resolveDefaultTokenExpiryDays } from "@getstrata/core/security/tokenExpiry";
import { restoreEnvVar } from "../helpers/restoreEnv";

describe("resolveDefaultTokenExpiryDays", () => {
  const previous = process.env.API_TOKEN_DEFAULT_EXPIRY_DAYS;

  afterEach(() => {
    if (previous === undefined) {
      delete process.env.API_TOKEN_DEFAULT_EXPIRY_DAYS;
    } else {
      restoreEnvVar("API_TOKEN_DEFAULT_EXPIRY_DAYS", previous);
    }
  });

  test("returns null when the env var is unset", () => {
    delete process.env.API_TOKEN_DEFAULT_EXPIRY_DAYS;

    expect(resolveDefaultTokenExpiryDays(process.env.API_TOKEN_DEFAULT_EXPIRY_DAYS)).toBeNull();
  });

  test("returns null for blank values", () => {
    process.env.API_TOKEN_DEFAULT_EXPIRY_DAYS = "   ";

    expect(resolveDefaultTokenExpiryDays(process.env.API_TOKEN_DEFAULT_EXPIRY_DAYS)).toBeNull();
  });

  test("rejects invalid integers", () => {
    process.env.API_TOKEN_DEFAULT_EXPIRY_DAYS = "0";
    expect(() =>
      resolveDefaultTokenExpiryDays(process.env.API_TOKEN_DEFAULT_EXPIRY_DAYS),
    ).toThrow();

    process.env.API_TOKEN_DEFAULT_EXPIRY_DAYS = "abc";
    expect(() =>
      resolveDefaultTokenExpiryDays(process.env.API_TOKEN_DEFAULT_EXPIRY_DAYS),
    ).toThrow();
  });

  test("returns positive integer day counts", () => {
    process.env.API_TOKEN_DEFAULT_EXPIRY_DAYS = "30";

    expect(resolveDefaultTokenExpiryDays(process.env.API_TOKEN_DEFAULT_EXPIRY_DAYS)).toBe(30);
  });
});
