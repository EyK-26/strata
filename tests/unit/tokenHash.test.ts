import { describe, expect, test } from "bun:test";
import { hashApiToken } from "../../src/core/auth/tokenHash";
import { TEST_ADMIN_API_TOKEN } from "../../src/domain/auth";

describe("hashApiToken", () => {
  test("returns a stable sha256 hex digest", () => {
    expect(hashApiToken(TEST_ADMIN_API_TOKEN)).toBe(hashApiToken(TEST_ADMIN_API_TOKEN));
    expect(hashApiToken(TEST_ADMIN_API_TOKEN)).toMatch(/^[a-f0-9]{64}$/);
  });
});
