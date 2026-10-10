import {
  createFieldEncryptionKeyring,
  type FieldEncryptionKeyring,
  type FieldEncryptionKeyringOptions,
  resolveFieldEncryptionKeyring,
} from "@getstrata/core/crypto/fieldEncryption";
export function fieldEncryptionKeyringContract(options: FieldEncryptionKeyringOptions): string {
  const configured = resolveFieldEncryptionKeyring();
  const version: 1 | 2 | undefined = configured?.writeVersion;
  if (version) configured?.encrypt("example", "email");
  const ring: FieldEncryptionKeyring = createFieldEncryptionKeyring(options);
  const encrypted: string = ring.encrypt("example", "email");
  const plaintext: string = ring.decrypt(encrypted, "email");
  const lookup: string = ring.lookup(plaintext);
  // @ts-expect-error Purpose must be explicit for authenticated field separation.
  ring.encrypt("example");
  return lookup;
}
