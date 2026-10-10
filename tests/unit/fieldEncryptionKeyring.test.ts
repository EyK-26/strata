import { expect, test } from "bun:test";
import {
  createFieldEncryptionKeyring,
  encryptField,
  type FieldEncryptionKeyringOptions,
  hashLookupValue,
} from "@getstrata/core/crypto/fieldEncryption";

const original = Buffer.alloc(32, 11);
const next = Buffer.alloc(32, 22);
const config = (): FieldEncryptionKeyringOptions => ({
  activeKeyId: "old",
  encryptionKeys: { old: original, next },
  legacyV1Key: original,
  lookupKey: original,
});
test("identified writes, retained reads and pinned lookups survive write-key rotation", () => {
  const old = createFieldEncryptionKeyring(config());
  const rotated = createFieldEncryptionKeyring({ ...config(), activeKeyId: "next" });
  for (const value of ["", "user@example.test", "JBSWY3DPEHPK3PXP", "é🙂"]) {
    const legacy = encryptField(value, original);
    const existing = old.encrypt(value, "email");
    const current = rotated.encrypt(value, "email");
    expect(existing.startsWith("enc:v2:old:")).toBe(true);
    expect(current.startsWith("enc:v2:next:")).toBe(true);
    for (const encrypted of [legacy, existing, current])
      expect(rotated.decrypt(encrypted, "email")).toBe(value);
    expect(rotated.lookup(value)).toBe(old.lookup(value));
    expect(rotated.lookup(value)).toBe(hashLookupValue(value, original));
    expect(rotated.encrypt(value, "email")).not.toBe(current);
  }
  const rollback = createFieldEncryptionKeyring(config());
  expect(rollback.decrypt(rotated.encrypt("value", "mfa"), "mfa")).toBe("value");
  const retired = createFieldEncryptionKeyring({
    activeKeyId: "next",
    encryptionKeys: { next },
    lookupKey: original,
  });
  expect(() => retired.decrypt(old.encrypt("private", "email"), "email")).toThrow(
    "Unable to decrypt",
  );
  expect(() => retired.decrypt(encryptField("private", original), "email")).toThrow(
    "Unable to decrypt",
  );
});
test("GCM authenticates key identifier, purpose, ciphertext, IV and full tag", () => {
  const ring = createFieldEncryptionKeyring({
    ...config(),
    encryptionKeys: { old: original, alias: original },
  });
  const stored = ring.encrypt("private", "email");
  expect(() => ring.decrypt(stored, "mfa")).toThrow("Unable to decrypt");
  expect(() => ring.decrypt(stored.replace(":old:", ":alias:"), "email")).toThrow(
    "Unable to decrypt",
  );
  const encoded = stored.split(":")[3] ?? "";
  for (const offset of [0, 12, Buffer.from(encoded, "base64").length - 1]) {
    const payload = Buffer.from(encoded, "base64");
    payload[offset] = (payload[offset] ?? 0) ^ 1;
    expect(() => ring.decrypt(`enc:v2:old:${payload.toString("base64")}`, "email")).toThrow(
      "Unable to decrypt",
    );
  }
  for (const value of [
    "plaintext",
    "enc:v3:old:any",
    "enc:v2:missing:any",
    "enc:v2:old:!!!!",
    "enc:v2:old:AA==",
    `${stored}:extra`,
    `${stored} `,
    "enc:v1:AA==",
    `enc:v2:old:${Buffer.alloc(28).toString("base64")}`,
  ]) {
    expect(() => ring.decrypt(value, "email")).toThrow("Unable to decrypt encrypted field.");
  }
  expect(() => ring.encrypt("private", "bad:purpose")).toThrow("Invalid field encryption purpose");
  expect(() => ring.decrypt(stored, "")).toThrow("Invalid field encryption purpose");
});
test("keyring configuration fails closed and takes immutable copies", () => {
  for (const options of [
    { ...config(), encryptionKeys: {} },
    {
      ...config(),
      encryptionKeys: Object.fromEntries(Array.from({ length: 33 }, (_, i) => [`k${i}`, original])),
    },
    { ...config(), encryptionKeys: { "bad:id": original } },
    { ...config(), activeKeyId: "missing" },
    { ...config(), lookupKey: Buffer.alloc(31) },
    { ...config(), legacyV1Key: Buffer.alloc(31) },
    { ...config(), encryptionKeys: { old: Buffer.alloc(31) } },
    { ...config(), lookupKey: "not bytes" as unknown as Uint8Array },
  ])
    expect(() => createFieldEncryptionKeyring(options)).toThrow();
  const mutable = Buffer.alloc(32, 7);
  const options = {
    activeKeyId: "old",
    encryptionKeys: { old: mutable },
    legacyV1Key: mutable,
    lookupKey: mutable,
  };
  const ring = createFieldEncryptionKeyring(options);
  const ciphertext = ring.encrypt("private", "email");
  const legacy = encryptField("legacy", mutable);
  const hash = ring.lookup("private");
  mutable.fill(9);
  options.activeKeyId = "other";
  options.encryptionKeys.old = next;
  expect(ring.decrypt(ciphertext, "email")).toBe("private");
  expect(ring.decrypt(legacy, "mfa")).toBe("legacy");
  expect(ring.lookup("private")).toBe(hash);
  expect(Object.isFrozen(ring)).toBe(true);
});
