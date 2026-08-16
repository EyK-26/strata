import { describe, expect, test } from "bun:test";
import { generateTotp, verifyTotp } from "@getstrata/core/security/totp";

describe("totp", () => {
  const secret = "JBSWY3DPEHPK3PXP";

  test("generates six digit codes", () => {
    const code = generateTotp(secret, 59_999_999);
    expect(code).toMatch(/^\d{6}$/u);
  });

  test("verifies generated codes within the default window", () => {
    const timestep = Math.floor(Date.now() / 30_000);
    const code = generateTotp(secret, timestep);
    expect(verifyTotp(secret, code)).toBe(true);
  });

  test("rejects invalid codes", () => {
    expect(verifyTotp(secret, "000000")).toBe(false);
    expect(verifyTotp(secret, "12345")).toBe(false);
    expect(verifyTotp(secret, "abcdef")).toBe(false);
  });

  test("rejects invalid base32 secrets", () => {
    expect(() => generateTotp("!!!!", 1)).toThrow("Invalid base32 character in MFA secret.");
  });
});
