import { describe, expect, test, afterEach } from "bun:test";
import {
  emailLookupForQuery,
  encryptField,
  decryptField,
  protectEmail,
  revealEmail,
  resolveEncryptionKey,
} from "../../src/core/crypto/fieldEncryption";

const previousEncryptionKey = process.env.KMS_ENCRYPTION_KEY;
const previousFeatureFlag = process.env.FEATURE_FIELD_ENCRYPTION;

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
});

describe("fieldEncryption", () => {
  test("encrypts and decrypts values with a 32-byte key", () => {
    process.env.KMS_ENCRYPTION_KEY = "a".repeat(64);
    process.env.FEATURE_FIELD_ENCRYPTION = "true";

    const key = resolveEncryptionKey();
    expect(key).not.toBeNull();

    const ciphertext = encryptField("admin@workhub.test", key!);
    expect(ciphertext.startsWith("enc:v1:")).toBe(true);
    expect(revealEmail(ciphertext)).toBe("admin@workhub.test");
    expect(decryptField(ciphertext, key!)).toBe("admin@workhub.test");
  });

  test("creates deterministic lookup hashes for encrypted emails", () => {
    process.env.KMS_ENCRYPTION_KEY = "b".repeat(64);
    process.env.FEATURE_FIELD_ENCRYPTION = "true";

    const protectedEmail = protectEmail("Admin@WorkHub.test");
    expect(protectedEmail.storedEmail.startsWith("enc:v1:")).toBe(true);
    expect(emailLookupForQuery("admin@workhub.test")).toBe(protectedEmail.emailLookup);
  });
});
