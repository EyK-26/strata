import { expect, test } from "bun:test";
import { BasicAuthGuard } from "@getstrata/core/auth/basicAuthGuard";
import { createFieldEncryptionCodec } from "@getstrata/core/crypto/fieldEncryption";
import { createMfaSecretCodec } from "@getstrata/core/crypto/mfaSecret";
import { generateTotp } from "@getstrata/core/security/totp";
import { restoreEnvVar } from "../helpers/restoreEnv";

test("interleaved crypto owners retain captured keyrings, feature flags and production plaintext policy", () => {
  const firstEnv = {
    KMS_ENCRYPTION_KEY: "11".repeat(32),
    FEATURE_FIELD_ENCRYPTION: "true",
    APP_ENV: "production",
  };
  const secondEnv = {
    KMS_ENCRYPTION_KEYRING: JSON.stringify({
      activeKeyId: "second",
      encryptionKeys: { second: "22".repeat(32) },
      lookupKey: "33".repeat(32),
      writeVersion: 2,
    }),
    FEATURE_FIELD_ENCRYPTION: "true",
    APP_ENV: "test",
  };
  const first = createFieldEncryptionCodec(firstEnv);
  const second = createFieldEncryptionCodec(secondEnv);
  const firstMfa = createMfaSecretCodec(firstEnv);
  const secondMfa = createMfaSecretCodec(secondEnv);
  const plaintextPolicy = { APP_ENV: "production" };
  const productionMfa = createMfaSecretCodec(plaintextPolicy);
  const developmentMfa = createMfaSecretCodec({ APP_ENV: "test" });
  firstEnv.KMS_ENCRYPTION_KEY = "invalid";
  firstEnv.FEATURE_FIELD_ENCRYPTION = "false";
  secondEnv.KMS_ENCRYPTION_KEYRING = "invalid";
  plaintextPolicy.APP_ENV = "test";
  for (const [fields, secrets, prefix] of [
    [first, firstMfa, "enc:v1:"],
    [second, secondMfa, "enc:v2:second:"],
  ] as const) {
    const value = fields.protectEmail(" User@Example.test ");
    expect(value.storedEmail.startsWith(prefix)).toBe(true);
    expect(fields.revealEmail(value.storedEmail)).toBe("user@example.test");
    expect(fields.emailLookupForQuery("USER@example.test")).toBe(value.emailLookup);
    expect(secrets.revealMfaSecret(secrets.protectMfaSecret("secret"))).toBe("secret");
  }
  expect(() => productionMfa.revealMfaSecret("legacy-plaintext")).toThrow("must be encrypted");
  expect(developmentMfa.revealMfaSecret("legacy-plaintext")).toBe("legacy-plaintext");
  expect(() => createFieldEncryptionCodec(firstEnv)).toThrow("KMS_ENCRYPTION_KEY");
  expect(() => createMfaSecretCodec(secondEnv)).toThrow("KMS_ENCRYPTION_KEYRING");
});

test("Basic authentication receives each application's captured MFA codec despite ambient key changes", async () => {
  const secret = "JBSWY3DPEHPK3PXP";
  const codecs = [
    createMfaSecretCodec({ KMS_ENCRYPTION_KEY: "11".repeat(32) }),
    createMfaSecretCodec({ KMS_ENCRYPTION_KEY: "22".repeat(32) }),
  ];
  const guards = codecs.map((mfaSecrets, index) => {
    const record = {
      id: index + 1,
      role: "member",
      mfa_enabled: true,
      mfa_secret: mfaSecrets.protectMfaSecret(secret),
    };
    return new BasicAuthGuard({
      mfaSecrets,
      accounts: { findByIdOrThrow: async () => record },
      credentials: { verifyCredentials: async () => ({ id: record.id }) },
      persistRecovery: async () => false,
    });
  });
  const previous = process.env.KMS_ENCRYPTION_KEY;
  process.env.KMS_ENCRYPTION_KEY = "invalid-after-assembly";
  try {
    for (const index of [0, 1, 0, 1]) {
      const authenticated = await guards[index]?.resolve(
        new Request("http://fixture.test", {
          headers: {
            authorization: `Basic ${btoa("user@example.test:password")}`,
            "x-mfa-code": generateTotp(secret),
          },
        }),
      );
      expect(authenticated?.id).toBe(index + 1);
    }
  } finally {
    restoreEnvVar("KMS_ENCRYPTION_KEY", previous);
  }
});
