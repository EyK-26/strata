import { isProductionEnv } from "../runtime/appEnv";
import {
  decryptField,
  encryptField,
  resolveEncryptionKey,
  resolveFieldEncryptionKeyring,
} from "./fieldEncryption";

interface MfaSecretCodec {
  protectMfaSecret(secret: string): string;
  revealMfaSecret(stored: string | null | undefined): string | null;
}

/** Capture the application's keyring and plaintext policy before request execution. */
function createMfaSecretCodec(env: Readonly<Record<string, string | undefined>>): MfaSecretCodec {
  const configured = resolveFieldEncryptionKeyring(env);
  const key = resolveEncryptionKey(env);
  const production = isProductionEnv(env);
  return Object.freeze({
    protectMfaSecret(secret: string): string {
      if (configured) return configured.encrypt(secret, "mfa");
      if (!key) throw new Error("MFA secrets require KMS_ENCRYPTION_KEY.");
      return encryptField(secret, key);
    },
    revealMfaSecret(stored: string | null | undefined): string | null {
      if (!stored) return null;
      if (configured) {
        if (!stored.startsWith("enc:")) throw new Error("MFA secrets must be encrypted.");
        return configured.keyring.decrypt(stored, "mfa");
      }
      if (stored.startsWith("enc:") && !stored.startsWith("enc:v1:"))
        throw new Error("Identified MFA secrets require KMS_ENCRYPTION_KEYRING.");
      if (!stored.startsWith("enc:v1:")) {
        if (production || key) throw new Error("MFA secrets must be encrypted.");
        return stored;
      }
      if (!key) throw new Error("MFA secrets require KMS_ENCRYPTION_KEY.");
      return decryptField(stored, key);
    },
  });
}
function protectMfaSecret(secret: string, codec: MfaSecretCodec): string {
  return codec.protectMfaSecret(secret);
}
function revealMfaSecret(stored: string | null | undefined, codec: MfaSecretCodec): string | null {
  return codec.revealMfaSecret(stored);
}

export type { MfaSecretCodec };
export { createMfaSecretCodec, protectMfaSecret, revealMfaSecret };
