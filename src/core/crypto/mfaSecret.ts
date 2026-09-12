import { decryptField, encryptField, resolveEncryptionKey } from "./fieldEncryption";

function protectMfaSecret(secret: string): string {
  const key = resolveEncryptionKey();

  if (!key) {
    throw new Error("MFA secrets require KMS_ENCRYPTION_KEY.");
  }

  return encryptField(secret, key);
}

function revealMfaSecret(stored: string | null | undefined): string | null {
  if (!stored) {
    return null;
  }

  if (!stored.startsWith("enc:v1:")) {
    return stored;
  }

  const key = resolveEncryptionKey();
  if (!key) {
    throw new Error("MFA secrets require KMS_ENCRYPTION_KEY.");
  }

  return decryptField(stored, key);
}

export { protectMfaSecret, revealMfaSecret };
