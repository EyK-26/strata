import { describe, expect, test } from "bun:test";
import {
  buildOtpauthUrl,
  generateTotp,
  generateTotpSecret,
  verifyTotp,
} from "@getstrata/core/security/totp";
import { restoreEnvVar } from "../helpers/restoreEnv";

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

  test("generateTotpSecret produces a verifiable secret", () => {
    const generated = generateTotpSecret();
    expect(generated).toMatch(/^[A-Z2-7]+$/u);
    const timestep = Math.floor(Date.now() / 30_000);
    expect(verifyTotp(generated, generateTotp(generated, timestep))).toBe(true);
  });

  test("buildOtpauthUrl encodes issuer and account", () => {
    const url = buildOtpauthUrl({
      secret: "JBSWY3DPEHPK3PXP",
      account: "admin@strata.test",
      issuer: "Strata",
    });

    expect(url.startsWith("otpauth://totp/")).toBe(true);
    expect(url).toContain("secret=JBSWY3DPEHPK3PXP");
    expect(url).toContain("issuer=Strata");
  });

  test("buildOtpauthUrl defaults the issuer from APP_NAME", () => {
    const previous = process.env.APP_NAME;

    try {
      delete process.env.APP_NAME;
      expect(
        buildOtpauthUrl({ secret: "JBSWY3DPEHPK3PXP", account: "admin@strata.test" }),
      ).toContain("issuer=Strata");

      process.env.APP_NAME = "Acme";
      expect(
        buildOtpauthUrl({ secret: "JBSWY3DPEHPK3PXP", account: "admin@strata.test" }),
      ).toContain("issuer=Acme");
    } finally {
      restoreEnvVar("APP_NAME", previous);
    }
  });
});
