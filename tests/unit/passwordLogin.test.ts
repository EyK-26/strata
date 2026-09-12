import { describe, expect, test } from "bun:test";
import {
  completePasswordLogin,
  persistConsumedRecoveryHash,
} from "@getstrata/core/auth/passwordLogin";
import { generateRecoveryCodes, hashRecoveryCode } from "@getstrata/core/security/recoveryCodes";
import { generateTotp, generateTotpSecret } from "@getstrata/core/security/totp";

describe("completePasswordLogin", () => {
  test("allows users without MFA", () => {
    expect(completePasswordLogin({ mfa_enabled: false })).toEqual({ ok: true });
  });

  test("requires an MFA code when enabled", () => {
    expect(completePasswordLogin({ mfa_enabled: true, mfa_secret: generateTotpSecret() })).toEqual({
      ok: false,
      error: "mfa_required",
    });
  });

  test("accepts a valid TOTP code", () => {
    const secret = generateTotpSecret();
    const code = generateTotp(secret, Math.floor(Date.now() / 30_000));
    expect(
      completePasswordLogin({ mfa_enabled: true, mfa_secret: secret }, { mfaCode: code }),
    ).toEqual({ ok: true });
  });

  test("accepts a recovery code and reports the consumed hash", () => {
    const [code] = generateRecoveryCodes(1);
    const hash = hashRecoveryCode(String(code));
    const result = completePasswordLogin(
      {
        mfa_enabled: true,
        mfa_secret: generateTotpSecret(),
        mfa_recovery_codes: JSON.stringify([hash]),
      },
      { mfaCode: code },
    );
    expect(result).toEqual({ ok: true, consumedRecoveryHash: hash });
  });

  test("rejects an invalid MFA code", () => {
    expect(
      completePasswordLogin(
        { mfa_enabled: true, mfa_secret: generateTotpSecret(), mfa_recovery_codes: "not-json" },
        { mfaCode: "000000" },
      ),
    ).toEqual({ ok: false, error: "mfa_invalid" });
    expect(
      completePasswordLogin(
        { mfa_enabled: true, mfa_secret: generateTotpSecret(), mfa_recovery_codes: "[]" },
        { mfaCode: "000000" },
      ),
    ).toEqual({ ok: false, error: "mfa_invalid" });
    expect(
      completePasswordLogin(
        { mfa_enabled: true, mfa_secret: generateTotpSecret(), mfa_recovery_codes: "[1,2]" },
        { mfaCode: "000000" },
      ),
    ).toEqual({ ok: false, error: "mfa_invalid" });
    expect(
      completePasswordLogin(
        { mfa_enabled: true, mfa_secret: generateTotpSecret(), mfa_recovery_codes: "" },
        { mfaCode: "000000" },
      ),
    ).toEqual({ ok: false, error: "mfa_invalid" });
  });

  test("persistConsumedRecoveryHash is a no-op without a consumed hash", async () => {
    const sql = {
      unsafe: async () => {
        throw new Error("should not write");
      },
    };
    await persistConsumedRecoveryHash(sql, 1, "[]", undefined);
  });

  test("persistConsumedRecoveryHash removes the consumed hash", async () => {
    const keep = hashRecoveryCode("keep-code");
    const used = hashRecoveryCode("used-code");
    let stored = "";
    const sql = {
      async unsafe(_query: string, params: readonly unknown[] = []) {
        stored = String(params[0]);
        return [];
      },
    };
    await persistConsumedRecoveryHash(sql, 4, JSON.stringify([keep, used]), used);
    expect(JSON.parse(stored)).toEqual([keep]);
  });
});
