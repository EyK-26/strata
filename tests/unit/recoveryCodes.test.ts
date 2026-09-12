import { describe, expect, test } from "bun:test";
import {
  DEFAULT_RECOVERY_CODE_COUNT,
  formatRecoveryCode,
  generateRecoveryCodes,
  hashRecoveryCode,
  normalizeRecoveryCode,
  recoveryCodeMatches,
} from "@getstrata/core/security/recoveryCodes";

describe("recoveryCodes", () => {
  test("generates unique dashed codes", () => {
    const codes = generateRecoveryCodes();
    expect(codes).toHaveLength(DEFAULT_RECOVERY_CODE_COUNT);
    expect(new Set(codes).size).toBe(DEFAULT_RECOVERY_CODE_COUNT);

    for (const code of codes) {
      expect(code).toMatch(/^([a-f0-9]{4}-){7}[a-f0-9]{4}$/u);
      expect(recoveryCodeMatches(code, hashRecoveryCode(code))).toBe(true);
    }
  });

  test("normalizes spacing, case, and missing dashes", () => {
    expect(normalizeRecoveryCode(" ABCD-EF12 ")).toBe("abcdef12");
    expect(normalizeRecoveryCode("AbCdEf12")).toBe("abcdef12");
    expect(formatRecoveryCode("abcdef12abcdef12abcdef12abcdef12")).toBe(
      "abcd-ef12-abcd-ef12-abcd-ef12-abcd-ef12",
    );
    expect(formatRecoveryCode("short")).toBe("short");
  });

  test("rejects a mismatched hash and falls back to eight codes", () => {
    const [code] = generateRecoveryCodes(1);
    expect(code).toBeTruthy();
    expect(recoveryCodeMatches("ffff-ffff", hashRecoveryCode(String(code)))).toBe(false);
    expect(generateRecoveryCodes(0)).toHaveLength(DEFAULT_RECOVERY_CODE_COUNT);
    expect(generateRecoveryCodes(-2)).toHaveLength(DEFAULT_RECOVERY_CODE_COUNT);
  });
});
