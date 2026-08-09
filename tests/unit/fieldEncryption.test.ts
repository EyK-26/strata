import { afterEach, describe, expect, test } from "bun:test";
import {
  decryptField,
  emailLookupForQuery,
  encryptField,
  isFieldEncryptionEnabled,
  protectEmail,
  resolveEncryptionKey,
  revealEmail,
} from "../../src/core/crypto/fieldEncryption";

const previousEncryptionKey = process.env.KMS_ENCRYPTION_KEY;
const previousFeatureFlag = process.env.FEATURE_FIELD_ENCRYPTION;
const previousAppEnv = process.env.APP_ENV;

afterEach(() => {
  if (previousEncryptionKey === undefined) {
    delete process.env.KMS_ENCRYPTION_KEY;
  } else {
    process.env.KMS_ENCRYPTION_KEY = previousEncryptionKey;
  }

  if (previousFeatureFlag === undefined) {
    delete process.env.FEATURE_FIELD_ENCRYPTION;
  } else {
    process.env.FEATURE_FIELD_ENCRYPTION = previousFeatureFlag;
  }

  if (previousAppEnv === undefined) {
    delete process.env.APP_ENV;
  } else {
    process.env.APP_ENV = previousAppEnv;
  }
});

describe("fieldEncryption", () => {
  test("encrypts and decrypts values with a 32-byte key", () => {
    process.env.KMS_ENCRYPTION_KEY = "a".repeat(64);
    process.env.FEATURE_FIELD_ENCRYPTION = "true";

    const key = resolveEncryptionKey();

    if (!key) {
      throw new Error("Expected encryption key to be configured.");
    }

    const ciphertext = encryptField("admin@workhub.test", key);
    expect(ciphertext.startsWith("enc:v1:")).toBe(true);
    expect(revealEmail(ciphertext)).toBe("admin@workhub.test");
    expect(decryptField(ciphertext, key)).toBe("admin@workhub.test");
  });

  test("creates deterministic lookup hashes for encrypted emails", () => {
    process.env.KMS_ENCRYPTION_KEY = "b".repeat(64);
    process.env.FEATURE_FIELD_ENCRYPTION = "true";

    const protectedEmail = protectEmail("Admin@WorkHub.test");
    expect(protectedEmail.storedEmail.startsWith("enc:v1:")).toBe(true);
    expect(emailLookupForQuery("admin@workhub.test")).toBe(protectedEmail.emailLookup);
  });

  test("returns plaintext when encryption is disabled or keys are missing", () => {
    delete process.env.KMS_ENCRYPTION_KEY;
    process.env.FEATURE_FIELD_ENCRYPTION = "false";

    const protectedEmail = protectEmail("Plain@Example.com");
    expect(protectedEmail.storedEmail).toBe("plain@example.com");
    expect(revealEmail("plain@example.com")).toBe("plain@example.com");
    expect(emailLookupForQuery("Plain@Example.com")).toBe("plain@example.com");
  });

  test("enables encryption automatically in production when the feature flag is unset", () => {
    process.env.KMS_ENCRYPTION_KEY = "c".repeat(64);
    delete process.env.FEATURE_FIELD_ENCRYPTION;
    process.env.APP_ENV = "production";

    const protectedEmail = protectEmail("prod@example.com");
    expect(protectedEmail.storedEmail.startsWith("enc:v1:")).toBe(true);
    expect(revealEmail(protectedEmail.storedEmail)).toBe("prod@example.com");
  });

  test("isFieldEncryptionEnabled respects explicit feature flag values", () => {
    process.env.FEATURE_FIELD_ENCRYPTION = "false";
    expect(isFieldEncryptionEnabled()).toBe(false);

    process.env.FEATURE_FIELD_ENCRYPTION = "true";
    expect(isFieldEncryptionEnabled()).toBe(true);

    delete process.env.FEATURE_FIELD_ENCRYPTION;
    process.env.APP_ENV = "local";
    expect(isFieldEncryptionEnabled()).toBe(false);
  });

  test("accepts base64 keys and rejects invalid key sizes", () => {
    process.env.KMS_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");
    expect(resolveEncryptionKey()?.length).toBe(32);

    process.env.KMS_ENCRYPTION_KEY = "too-short";
    expect(() => resolveEncryptionKey()).toThrow("KMS_ENCRYPTION_KEY must be 32 bytes");
  });

  test("decryptField returns plaintext values unchanged", () => {
    const key = Buffer.alloc(32, 1);
    expect(decryptField("plain-text", key)).toBe("plain-text");
  });
});
