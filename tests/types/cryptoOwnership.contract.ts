import {
  createFieldEncryptionCodec,
  protectEmail,
  resolveEncryptionKey,
  resolveFieldEncryptionKeyring,
} from "@getstrata/core/crypto/fieldEncryption";
import { createMfaSecretCodec, revealMfaSecret } from "@getstrata/core/crypto/mfaSecret";

function explicitCryptoOwnership() {
  const fields = createFieldEncryptionCodec({ FEATURE_FIELD_ENCRYPTION: "false" });
  const secrets = createMfaSecretCodec({ APP_ENV: "test" });
  protectEmail("user@example.test", fields);
  revealMfaSecret("legacy", secrets);
  // @ts-expect-error An owner must supply its environment explicitly.
  createFieldEncryptionCodec();
  // @ts-expect-error An owner must supply its plaintext policy explicitly.
  createMfaSecretCodec();
  // @ts-expect-error Pure helpers cannot resolve ambient application configuration.
  protectEmail("user@example.test");
  // @ts-expect-error Key resolution has no ambient default.
  resolveEncryptionKey();
  // @ts-expect-error Keyring resolution has no ambient default.
  resolveFieldEncryptionKeyring();
}
void explicitCryptoOwnership;
