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
  test("returns plaintext when field encryption is disabled", async () => {
    delete process.env.KMS_ENCRYPTION_KEY;
    delete process.env.FEATURE_FIELD_ENCRYPTION;

    const { protectMfaSecret, revealMfaSecret } = await import("@getstrata/core/crypto/mfaSecret");

    expect(protectMfaSecret("JBSWY3DPEHPK3PXP")).toBe("JBSWY3DPEHPK3PXP");
    expect(revealMfaSecret("JBSWY3DPEHPK3PXP")).toBe("JBSWY3DPEHPK3PXP");
    expect(revealMfaSecret(null)).toBeNull();
    expect(revealMfaSecret(undefined)).toBeNull();
  });

  test("encrypts and decrypts MFA secrets when encryption is enabled", async () => {
    process.env.KMS_ENCRYPTION_KEY = "c".repeat(64);
    process.env.FEATURE_FIELD_ENCRYPTION = "true";

    const { protectMfaSecret, revealMfaSecret } = await import("@getstrata/core/crypto/mfaSecret");
    const protectedSecret = protectMfaSecret("JBSWY3DPEHPK3PXP");

    expect(protectedSecret.startsWith("enc:v1:")).toBe(true);
    expect(revealMfaSecret(protectedSecret)).toBe("JBSWY3DPEHPK3PXP");
  });

  test("returns stored value when encryption key is missing", async () => {
    process.env.FEATURE_FIELD_ENCRYPTION = "true";
    delete process.env.KMS_ENCRYPTION_KEY;

    const { protectMfaSecret, revealMfaSecret } = await import("@getstrata/core/crypto/mfaSecret");

    expect(protectMfaSecret("plain-secret")).toBe("plain-secret");
    expect(revealMfaSecret("plain-secret")).toBe("plain-secret");
  });

  test("returns stored value when ciphertext is not encrypted", async () => {
    process.env.KMS_ENCRYPTION_KEY = "d".repeat(64);
    process.env.FEATURE_FIELD_ENCRYPTION = "true";

    const { revealMfaSecret } = await import("@getstrata/core/crypto/mfaSecret");

    expect(revealMfaSecret("legacy-plain-secret")).toBe("legacy-plain-secret");
  });
});
