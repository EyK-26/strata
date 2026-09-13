import { describe, expect, test } from "bun:test";
import {
  hasVerifiedEmail,
  isEmailVerificationRequired,
} from "@getstrata/core/auth/emailVerification";
import { restoreEnvVar } from "../helpers/restoreEnv";

describe("emailVerification", () => {
  test("isEmailVerificationRequired reads FEATURE_EMAIL_VERIFICATION", () => {
    const previous = process.env.FEATURE_EMAIL_VERIFICATION;

    try {
      delete process.env.FEATURE_EMAIL_VERIFICATION;
      expect(isEmailVerificationRequired()).toBe(false);

      process.env.FEATURE_EMAIL_VERIFICATION = "true";
      expect(isEmailVerificationRequired()).toBe(true);

      process.env.FEATURE_EMAIL_VERIFICATION = "false";
      expect(isEmailVerificationRequired()).toBe(false);
    } finally {
      restoreEnvVar("FEATURE_EMAIL_VERIFICATION", previous);
    }
  });

  test("hasVerifiedEmail treats missing, undefined, and null timestamps as unverified", () => {
    expect(hasVerifiedEmail({ id: 1 })).toBe(false);
    expect(hasVerifiedEmail({ id: 1, emailVerifiedAt: undefined })).toBe(false);
    expect(hasVerifiedEmail({ id: 1, emailVerifiedAt: new Date() })).toBe(true);
    expect(hasVerifiedEmail({ id: 1, emailVerifiedAt: "2026-01-01T00:00:00.000Z" })).toBe(true);
    expect(hasVerifiedEmail({ id: 1, emailVerifiedAt: null })).toBe(false);
  });
});
