import {
  createFieldEncryptionKeyring,
  type FieldEncryptionKeyring,
  type FieldEncryptionKeyringOptions,
} from "@getstrata/core/crypto/fieldEncryption";
export function fieldEncryptionKeyringContract(options: FieldEncryptionKeyringOptions): string {
  const ring: FieldEncryptionKeyring = createFieldEncryptionKeyring(options);
  const encrypted: string = ring.encrypt("example", "email");
  const plaintext: string = ring.decrypt(encrypted, "email");
  const lookup: string = ring.lookup(plaintext);
  // @ts-expect-error Purpose must be explicit for authenticated field separation.
  ring.encrypt("example");
  return lookup;
}
