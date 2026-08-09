import {
  decryptField,
  encryptField,
  isFieldEncryptionEnabled,
  resolveEncryptionKey,
} from "./fieldEncryption";

function protectMfaSecret(secret: string): string {
  const key = resolveEncryptionKey();

  if (!isFieldEncryptionEnabled() || !key) {
    return secret;
  }

  return encryptField(secret, key);
}

function revealMfaSecret(stored: string | null | undefined): string | null {
  if (!stored) {
    return null;
  }

  const key = resolveEncryptionKey();

  if (!isFieldEncryptionEnabled() || !key || !stored.startsWith("enc:v1:")) {
    return stored;
  }

  return decryptField(stored, key);
}

export { protectMfaSecret, revealMfaSecret };
