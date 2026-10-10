import { isProductionEnv } from "../runtime/appEnv";
import {
  decryptField,
  encryptField,
  resolveEncryptionKey,
  resolveFieldEncryptionKeyring,
} from "./fieldEncryption";

function protectMfaSecret(secret: string): string {
  const configured = resolveFieldEncryptionKeyring();
  if (configured) return configured.encrypt(secret, "mfa");
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

  const configured = resolveFieldEncryptionKeyring();
  if (configured) {
    if (!stored.startsWith("enc:")) throw new Error("MFA secrets must be encrypted.");
    return configured.keyring.decrypt(stored, "mfa");
  }
  if (stored.startsWith("enc:") && !stored.startsWith("enc:v1:"))
    throw new Error("Identified MFA secrets require KMS_ENCRYPTION_KEYRING.");

  if (!stored.startsWith("enc:v1:")) {
    if (isProductionEnv() || resolveEncryptionKey()) {
      throw new Error("MFA secrets must be encrypted.");
    }

    return stored;
  }

  const key = resolveEncryptionKey();
  if (!key) {
    throw new Error("MFA secrets require KMS_ENCRYPTION_KEY.");
  }

  return decryptField(stored, key);
}

export { protectMfaSecret, revealMfaSecret };
