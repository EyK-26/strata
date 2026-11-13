import { afterEach, describe, expect, test } from "bun:test";
import {
  createFieldEncryptionCodec,
  decryptField,
  emailLookupForQuery,
  encryptField,
  isFieldEncryptionEnabled,
  protectEmail,
  resolveEncryptionKey,
  revealEmail,
} from "@getstrata/core/crypto/fieldEncryption";
import { restoreEnvVar } from "../helpers/restoreEnv";

const previousEncryptionKey = process.env.KMS_ENCRYPTION_KEY;
const previousFeatureFlag = process.env.FEATURE_FIELD_ENCRYPTION;
const previousAppEnv = process.env.APP_ENV;

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

  if (previousAppEnv === undefined) {
    delete process.env.APP_ENV;
  } else {
    restoreEnvVar("APP_ENV", previousAppEnv);
  }
});

describe("fieldEncryption", () => {
  test("encrypts and decrypts values with a 32-byte key", () => {
    process.env.KMS_ENCRYPTION_KEY = "a".repeat(64);
    process.env.FEATURE_FIELD_ENCRYPTION = "true";

    const key = resolveEncryptionKey(process.env);

    if (!key) {
      throw new Error("Expected encryption key to be configured.");
    }

    const ciphertext = encryptField("admin@strata.test", key);
    expect(ciphertext.startsWith("enc:v1:")).toBe(true);
    expect(revealEmail(ciphertext, createFieldEncryptionCodec(process.env))).toBe(
      "admin@strata.test",
    );
    expect(decryptField(ciphertext, key)).toBe("admin@strata.test");
  });

  test("creates deterministic lookup hashes for encrypted emails", () => {
    process.env.KMS_ENCRYPTION_KEY = "b".repeat(64);
    process.env.FEATURE_FIELD_ENCRYPTION = "true";

    const protectedEmail = protectEmail(
      "Admin@Strata.test",
      createFieldEncryptionCodec(process.env),
    );
    expect(protectedEmail.storedEmail.startsWith("enc:v1:")).toBe(true);
    expect(emailLookupForQuery("admin@strata.test", createFieldEncryptionCodec(process.env))).toBe(
      protectedEmail.emailLookup,
    );
  });

  test("returns plaintext when encryption is disabled or keys are missing", () => {
    delete process.env.KMS_ENCRYPTION_KEY;
    process.env.FEATURE_FIELD_ENCRYPTION = "false";

    const protectedEmail = protectEmail(
      "Plain@Example.com",
      createFieldEncryptionCodec(process.env),
    );
    expect(protectedEmail.storedEmail).toBe("plain@example.com");
    expect(revealEmail("plain@example.com", createFieldEncryptionCodec(process.env))).toBe(
      "plain@example.com",
    );
    expect(emailLookupForQuery("Plain@Example.com", createFieldEncryptionCodec(process.env))).toBe(
      "plain@example.com",
    );
  });

  test("enables encryption automatically in production when the feature flag is unset", () => {
    process.env.KMS_ENCRYPTION_KEY = "c".repeat(64);
    delete process.env.FEATURE_FIELD_ENCRYPTION;
    process.env.APP_ENV = "production";

    const protectedEmail = protectEmail(
      "prod@example.com",
      createFieldEncryptionCodec(process.env),
    );
    expect(protectedEmail.storedEmail.startsWith("enc:v1:")).toBe(true);
    expect(revealEmail(protectedEmail.storedEmail, createFieldEncryptionCodec(process.env))).toBe(
      "prod@example.com",
    );
  });

  test("isFieldEncryptionEnabled respects explicit feature flag values", () => {
    process.env.FEATURE_FIELD_ENCRYPTION = "false";
    expect(isFieldEncryptionEnabled(createFieldEncryptionCodec(process.env))).toBe(false);

    process.env.FEATURE_FIELD_ENCRYPTION = "true";
    expect(isFieldEncryptionEnabled(createFieldEncryptionCodec(process.env))).toBe(true);

    delete process.env.FEATURE_FIELD_ENCRYPTION;
    process.env.APP_ENV = "local";
    expect(isFieldEncryptionEnabled(createFieldEncryptionCodec(process.env))).toBe(false);
  });

  test("accepts base64 keys and rejects invalid key sizes", () => {
    process.env.KMS_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");
    expect(resolveEncryptionKey(process.env)?.length).toBe(32);

    process.env.KMS_ENCRYPTION_KEY = "too-short";
    expect(() => resolveEncryptionKey(process.env)).toThrow("KMS_ENCRYPTION_KEY must be 32 bytes");
  });

  test("decryptField returns plaintext values unchanged", () => {
    const key = Buffer.alloc(32, 1);
    expect(decryptField("plain-text", key)).toBe("plain-text");
  });
});
