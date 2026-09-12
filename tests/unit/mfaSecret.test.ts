import { afterAll, afterEach, describe, expect, mock, test } from "bun:test";
import { restoreEnvVar } from "../helpers/restoreEnv";

const previousEncryptionKey = process.env.KMS_ENCRYPTION_KEY;
const previousFeatureFlag = process.env.FEATURE_FIELD_ENCRYPTION;

afterEach(() => {
  if (previousEncryptionKey === undefined) {
    delete process.env.KMS_ENCRYPTION_KEY;
  } else {
    restoreEnvVar("KMS_ENCRYPTION_KEY", previousEncryptionKey);
  }

  if (previousFeatureFlag === undefined) {
    delete process.env.FEATURE_FIELD_ENCRYPTION;
  } else {
    restoreEnvVar("FEATURE_FIELD_ENCRYPTION", previousFeatureFlag);
  }
});

afterAll(() => {
  mock.restore();
});

describe("mfaSecret", () => {
  test("refuses to store plaintext when the encryption key is missing", async () => {
    delete process.env.KMS_ENCRYPTION_KEY;
    delete process.env.FEATURE_FIELD_ENCRYPTION;

    const { protectMfaSecret, revealMfaSecret } = await import("@getstrata/core/crypto/mfaSecret");

    expect(() => protectMfaSecret("JBSWY3DPEHPK3PXP")).toThrow("KMS_ENCRYPTION_KEY");
    expect(revealMfaSecret("JBSWY3DPEHPK3PXP")).toBe("JBSWY3DPEHPK3PXP");
    expect(revealMfaSecret(null)).toBeNull();
    expect(revealMfaSecret(undefined)).toBeNull();
  });

  test("encrypts MFA secrets whenever a key is present", async () => {
    process.env.KMS_ENCRYPTION_KEY = "c".repeat(64);
    delete process.env.FEATURE_FIELD_ENCRYPTION;

    const { protectMfaSecret, revealMfaSecret } = await import("@getstrata/core/crypto/mfaSecret");
    const protectedSecret = protectMfaSecret("JBSWY3DPEHPK3PXP");

    expect(protectedSecret.startsWith("enc:v1:")).toBe(true);
    expect(revealMfaSecret(protectedSecret)).toBe("JBSWY3DPEHPK3PXP");
  });

  test("returns stored plaintext when decrypt is not available", async () => {
    process.env.FEATURE_FIELD_ENCRYPTION = "true";
    delete process.env.KMS_ENCRYPTION_KEY;

    const { revealMfaSecret } = await import("@getstrata/core/crypto/mfaSecret");

    expect(revealMfaSecret("plain-secret")).toBe("plain-secret");
    expect(() => revealMfaSecret("enc:v1:ciphertext")).toThrow("KMS_ENCRYPTION_KEY");
  });

  test("decrypts MFA secrets even when FEATURE_FIELD_ENCRYPTION is false", async () => {
    process.env.KMS_ENCRYPTION_KEY = "e".repeat(64);
    process.env.FEATURE_FIELD_ENCRYPTION = "false";

    const { protectMfaSecret, revealMfaSecret } = await import("@getstrata/core/crypto/mfaSecret");
    const protectedSecret = protectMfaSecret("JBSWY3DPEHPK3PXP");
    expect(protectedSecret.startsWith("enc:v1:")).toBe(true);
    expect(revealMfaSecret(protectedSecret)).toBe("JBSWY3DPEHPK3PXP");
  });

  test("returns stored plaintext outside production", async () => {
    process.env.KMS_ENCRYPTION_KEY = "d".repeat(64);
    process.env.FEATURE_FIELD_ENCRYPTION = "true";

    const { revealMfaSecret } = await import("@getstrata/core/crypto/mfaSecret");

    expect(revealMfaSecret("legacy-plain-secret")).toBe("legacy-plain-secret");
  });

  test("rejects plaintext MFA secrets in production", async () => {
    const previous = process.env.APP_ENV;
    process.env.APP_ENV = "production";
    process.env.KMS_ENCRYPTION_KEY = "d".repeat(64);
    try {
      const { revealMfaSecret } = await import("@getstrata/core/crypto/mfaSecret");
      expect(() => revealMfaSecret("legacy-plain-secret")).toThrow("must be encrypted");
    } finally {
      restoreEnvVar("APP_ENV", previous);
    }
  });
});
